import { Hono } from 'hono';
import {
  createGrowthDraft,
  getGrowthDrafts,
  getGrowthDraft,
  updateGrowthDraft,
  setGrowthDraftStatus,
  upsertGrowthDigest,
  getLatestGrowthDigest,
  getGrowthDigestByDate,
  createScheduledPost,
  resolveFreeSlot,
  archiveExpiredGrowthDrafts,
  unarchiveGrowthDrafts,
  jstDayStart,
  parseScheduledAtMs,
  getXAccountById,
} from '@x-harness/db';
import type { Env } from '../index.js';
import { buildXClient } from '../services/x-client.js';
import { checkTextLength, tooLongResponseBody } from '../services/post-length.js';

const growth = new Hono<Env>();

// POST /api/growth/drafts — create a draft
growth.post('/api/growth/drafts', async (c) => {
  const body = await c.req.json<{
    xAccountId?: string;
    type?: string;
    text?: string;
    scheduledAt?: string;
    quoteTweetId?: string;
  }>();
  const { xAccountId, type, text, scheduledAt, quoteTweetId } = body;
  if (!xAccountId || !type || !text || !scheduledAt) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, type, text, scheduledAt' }, 400);
  }
  const draft = await createGrowthDraft(c.env.DB, { xAccountId, type, text, scheduledAt, quoteTweetId });
  return c.json({ success: true, data: draft }, 201);
});

type PostStatusRow = {
  id: string;
  status: string;
  posted_tweet_id: string | null;
  last_error?: string | null;
  last_error_status?: number | null;
};

// D1 bounds bound parameters per statement; stay well under it.
const STATUS_LOOKUP_CHUNK = 90;

async function selectPostStatuses(db: D1Database, ids: string[], withErrors: boolean): Promise<PostStatusRow[]> {
  const cols = withErrors ? 'id, status, posted_tweet_id, last_error, last_error_status' : 'id, status, posted_tweet_id';
  const rows: PostStatusRow[] = [];
  for (let i = 0; i < ids.length; i += STATUS_LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + STATUS_LOOKUP_CHUNK);
    const result = await db
      .prepare(`SELECT ${cols} FROM scheduled_posts WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<PostStatusRow>();
    rows.push(...result.results);
  }
  return rows;
}

// One query per 90 drafts (was one per draft). Falls back once to the
// pre-020 column set when the error columns do not exist yet.
async function loadPostStatuses(db: D1Database, ids: string[]): Promise<Map<string, PostStatusRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  let rows: PostStatusRow[];
  try {
    rows = await selectPostStatuses(db, unique, true);
  } catch (err) {
    if (!(err instanceof Error) || !/no such column/i.test(err.message)) throw err;
    rows = await selectPostStatuses(db, unique, false);
  }
  return new Map(rows.map((r) => [r.id, r]));
}

// Original fields (postStatus/postedTweetId) are unchanged; postLastError and
// postLastErrorStatus are additive and explain a failed scheduled post.
async function withPostStatuses<T extends { scheduled_post_id: string | null }>(db: D1Database, drafts: T[]) {
  const statuses = await loadPostStatuses(
    db,
    drafts.map((d) => d.scheduled_post_id).filter((id): id is string => Boolean(id)),
  );
  return drafts.map((draft) => {
    const row = draft.scheduled_post_id ? statuses.get(draft.scheduled_post_id) : undefined;
    return {
      ...draft,
      postStatus: row?.status ?? null,
      postedTweetId: row?.posted_tweet_id ?? null,
      postLastError: row?.last_error ?? null,
      postLastErrorStatus: row?.last_error_status ?? null,
    };
  });
}

const DRAFT_LIST_MAX_LIMIT = 500;

// GET /api/growth/drafts — list drafts with optional filters, attach post status if scheduled
// Optional `limit` (1-500) / `offset` paginate; without them every match is returned (as before).
growth.get('/api/growth/drafts', async (c) => {
  const status = c.req.query('status');
  const xAccountId = c.req.query('xAccountId');
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');
  let drafts = await getGrowthDrafts(c.env.DB, { status, xAccountId });
  if (limitParam !== undefined || offsetParam !== undefined) {
    const limit = limitParam === undefined ? DRAFT_LIST_MAX_LIMIT : Number(limitParam);
    const offset = offsetParam === undefined ? 0 : Number(offsetParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > DRAFT_LIST_MAX_LIMIT || !Number.isInteger(offset) || offset < 0) {
      return c.json({ success: false, error: `limit must be 1-${DRAFT_LIST_MAX_LIMIT} and offset >= 0` }, 400);
    }
    drafts = drafts.slice(offset, offset + limit);
  }
  const results = await withPostStatuses(c.env.DB, drafts);
  return c.json({ success: true, data: results });
});

// Optional JSON body: empty → {}, malformed → null (caller answers 400).
async function readOptionalJson<T extends object>(req: { text: () => Promise<string> }): Promise<Partial<T> | null> {
  const raw = (await req.text()).trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<T>) : null;
  } catch {
    return null;
  }
}

// POST /api/growth/drafts/archive-expired — hide expired pending drafts from
// the queue. Nothing is deleted and status stays 'pending' (archived_at is
// set), so /unarchive restores them. Body: { before?: ISO (default start of
// today JST), xAccountId?, dryRun? }. Returns { count, archivedAt, before }.
growth.post('/api/growth/drafts/archive-expired', async (c) => {
  const body = await readOptionalJson<{ before?: string; xAccountId?: string; dryRun?: boolean }>(c.req);
  if (!body) return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  if (body.before !== undefined && (typeof body.before !== 'string' || Number.isNaN(parseScheduledAtMs(body.before)))) {
    return c.json({ success: false, error: 'before must be an ISO date-time' }, 400);
  }
  // Never archive today's (JST) or future drafts: they are the live queue.
  if (body.before !== undefined && parseScheduledAtMs(body.before) > parseScheduledAtMs(jstDayStart())) {
    return c.json({ success: false, error: 'before must not be later than the start of today (JST)' }, 400);
  }
  const result = await archiveExpiredGrowthDrafts(c.env.DB, {
    before: body.before,
    xAccountId: typeof body.xAccountId === 'string' ? body.xAccountId : undefined,
    dryRun: body.dryRun === true,
  });
  return c.json({ success: true, data: { ...result, dryRun: body.dryRun === true } });
});

// POST /api/growth/drafts/unarchive — undo an archive. Body: one of
// { archivedAt } (a batch), { ids: string[] }, or { all: true }.
growth.post('/api/growth/drafts/unarchive', async (c) => {
  const body = await readOptionalJson<{ archivedAt?: string; ids?: unknown; all?: boolean }>(c.req);
  if (!body) return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined;
  const archivedAt = typeof body.archivedAt === 'string' && body.archivedAt ? body.archivedAt : undefined;
  if (!ids?.length && !archivedAt && body.all !== true) {
    return c.json({ success: false, error: 'Provide archivedAt, ids, or all: true' }, 400);
  }
  const count = await unarchiveGrowthDrafts(c.env.DB, { ids, archivedAt, all: body.all === true });
  return c.json({ success: true, data: { count } });
});

// GET /api/growth/drafts/:id — one draft, with the linked scheduled post's status/error
growth.get('/api/growth/drafts/:id', async (c) => {
  const draft = await getGrowthDraft(c.env.DB, c.req.param('id'));
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  const [withStatus] = await withPostStatuses(c.env.DB, [draft]);
  return c.json({ success: true, data: withStatus });
});

// PATCH /api/growth/drafts/:id — partial update (pending only)
growth.patch('/api/growth/drafts/:id', async (c) => {
  const id = c.req.param('id');
  const draft = await getGrowthDraft(c.env.DB, id);
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  if (draft.status !== 'pending') {
    return c.json({ success: false, error: 'Draft is not pending' }, 409);
  }
  if (draft.archived_at) {
    return c.json({ success: false, error: 'Draft is archived — unarchive it first' }, 409);
  }
  const body = await c.req.json<{ text?: string; scheduledAt?: string }>();
  await updateGrowthDraft(c.env.DB, id, { text: body.text, scheduledAt: body.scheduledAt });
  const updated = await getGrowthDraft(c.env.DB, id);
  return c.json({ success: true, data: updated });
});

// POST /api/growth/drafts/:id/approve
growth.post('/api/growth/drafts/:id/approve', async (c) => {
  const id = c.req.param('id');
  const draft = await getGrowthDraft(c.env.DB, id);
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  if (draft.status !== 'pending') {
    return c.json({ success: false, error: 'Draft is not pending' }, 409);
  }
  if (draft.archived_at) {
    return c.json({ success: false, error: 'Draft is archived — unarchive it first' }, 409);
  }
  // Over-limit text would only fail at send time — refuse the approval now.
  const length = await checkTextLength(c.env.DB, async () => {
    const account = await getXAccountById(c.env.DB, draft.x_account_id);
    if (!account) throw new Error('X account not found');
    return buildXClient(c.env, account, 'posts');
  }, draft.x_account_id, draft.text);
  if (!length.ok) return c.json(tooLongResponseBody(length), 400);
  // Drafts carry the slot the planner picked at generation time. By approval
  // time that slot may be stale or claimed by a post approved from another
  // batch — both used to fire as a simultaneous burst on the next cron tick.
  const scheduledAt = await resolveFreeSlot(c.env.DB, draft.x_account_id, draft.scheduled_at, { rollStale: true });
  const post = await createScheduledPost(
    c.env.DB,
    draft.x_account_id,
    draft.text,
    scheduledAt,
    undefined,
    draft.quote_tweet_id ?? undefined,
  );
  if (scheduledAt !== draft.scheduled_at) {
    // Keep the draft row in sync so the dashboard shows the resolved slot.
    await updateGrowthDraft(c.env.DB, id, { scheduledAt });
  }
  await setGrowthDraftStatus(c.env.DB, id, 'scheduled', post.id);
  return c.json({
    success: true,
    data: { ...draft, status: 'scheduled', scheduled_at: scheduledAt, scheduledPostId: post.id },
  });
});

// POST /api/growth/drafts/:id/reject
growth.post('/api/growth/drafts/:id/reject', async (c) => {
  const id = c.req.param('id');
  const draft = await getGrowthDraft(c.env.DB, id);
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  if (draft.status !== 'pending') {
    return c.json({ success: false, error: 'Draft is not pending' }, 409);
  }
  if (draft.archived_at) {
    return c.json({ success: false, error: 'Draft is archived — unarchive it first' }, 409);
  }
  await setGrowthDraftStatus(c.env.DB, id, 'rejected');
  return c.json({ success: true });
});

// POST /api/growth/digest — shallow-merge upsert
growth.post('/api/growth/digest', async (c) => {
  const body = await c.req.json<{ date?: string; payload?: Record<string, unknown> }>();
  const { date, payload } = body;
  if (!date || !payload) {
    return c.json({ success: false, error: 'Missing required fields: date, payload' }, 400);
  }
  // Fetch existing row for the same date for shallow merge
  const existing = await getGrowthDigestByDate(c.env.DB, date);
  let merged: Record<string, unknown> = payload;
  if (existing) {
    try {
      const oldPayload = JSON.parse(existing.payload) as Record<string, unknown>;
      merged = { ...oldPayload, ...payload };
    } catch {
      // old payload not parseable — overwrite
    }
  }
  await upsertGrowthDigest(c.env.DB, date, JSON.stringify(merged));
  return c.json({ success: true });
});

// GET /api/growth/digest/latest
growth.get('/api/growth/digest/latest', async (c) => {
  const row = await getLatestGrowthDigest(c.env.DB);
  if (!row) return c.json({ success: true, data: null });
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return c.json({ success: true, data: { date: row.date, payload } });
});

growth.get('/api/growth/digest',async c=>{
 const accountId=c.req.query('xAccountId');if(!accountId)return c.json({success:false,error:'xAccountId required'},400);
 const row=await c.env.DB.prepare("SELECT json,created_at FROM ai_outputs WHERE x_account_id=? AND feature='digest' ORDER BY created_at DESC LIMIT 1").bind(accountId).first<{json:string;created_at:string}>();
 return c.json({success:true,data:row?{...JSON.parse(row.json),createdAt:row.created_at}:null});
});
export { growth };
