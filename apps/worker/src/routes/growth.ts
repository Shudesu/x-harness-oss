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
} from '@x-harness/db';
import type { Env } from '../index.js';

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

// GET /api/growth/drafts — list drafts with optional filters, attach post status if scheduled
growth.get('/api/growth/drafts', async (c) => {
  const status = c.req.query('status');
  const xAccountId = c.req.query('xAccountId');
  const drafts = await getGrowthDrafts(c.env.DB, { status, xAccountId });
  const results = await Promise.all(
    drafts.map(async (draft) => {
      if (!draft.scheduled_post_id) return { ...draft, postStatus: null, postedTweetId: null };
      const row = await c.env.DB
        .prepare('SELECT status, posted_tweet_id FROM scheduled_posts WHERE id = ?')
        .bind(draft.scheduled_post_id)
        .first<{ status: string; posted_tweet_id: string | null }>();
      return {
        ...draft,
        postStatus: row?.status ?? null,
        postedTweetId: row?.posted_tweet_id ?? null,
      };
    }),
  );
  return c.json({ success: true, data: results });
});

// PATCH /api/growth/drafts/:id — partial update (pending only)
growth.patch('/api/growth/drafts/:id', async (c) => {
  const id = c.req.param('id');
  const draft = await getGrowthDraft(c.env.DB, id);
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  if (draft.status !== 'pending') {
    return c.json({ success: false, error: 'Draft is not pending' }, 409);
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
  const post = await createScheduledPost(
    c.env.DB,
    draft.x_account_id,
    draft.text,
    draft.scheduled_at,
    undefined,
    draft.quote_tweet_id ?? undefined,
  );
  await setGrowthDraftStatus(c.env.DB, id, 'scheduled', post.id);
  return c.json({ success: true, data: { ...draft, status: 'scheduled', scheduledPostId: post.id } });
});

// POST /api/growth/drafts/:id/reject
growth.post('/api/growth/drafts/:id/reject', async (c) => {
  const id = c.req.param('id');
  const draft = await getGrowthDraft(c.env.DB, id);
  if (!draft) return c.json({ success: false, error: 'Not found' }, 404);
  if (draft.status !== 'pending') {
    return c.json({ success: false, error: 'Draft is not pending' }, 409);
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

export { growth };
