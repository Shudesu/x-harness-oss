import { jstNow, toJstString } from './utils.js';

export interface DbScheduledPost {
  id: string;
  x_account_id: string;
  text: string;
  media_ids: string | null;
  quote_tweet_id: string | null;
  scheduled_at: string;
  status: string;
  posted_tweet_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createScheduledPost(db: D1Database, xAccountId: string, text: string, scheduledAt: string, mediaIds?: string[], quoteTweetId?: string): Promise<DbScheduledPost> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare('INSERT INTO scheduled_posts (id, x_account_id, text, media_ids, quote_tweet_id, scheduled_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(id, xAccountId, text, mediaIds ? JSON.stringify(mediaIds) : null, quoteTweetId ?? null, scheduledAt, 'scheduled', now, now)
    .first<DbScheduledPost>();
  return result!;
}

export async function getScheduledPosts(db: D1Database, opts: { status?: string; xAccountId?: string } = {}): Promise<DbScheduledPost[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) { conditions.push('status = ?'); binds.push(opts.status); }
  if (opts.xAccountId) { conditions.push('x_account_id = ?'); binds.push(opts.xAccountId); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.prepare(`SELECT * FROM scheduled_posts ${where} ORDER BY scheduled_at ASC`).bind(...binds).all<DbScheduledPost>();
  return result.results;
}

const SLOT_CONFLICT_WINDOW_MS = 45 * 60_000;
const SLOT_BUMP_MS = 60 * 60_000;
const STALE_GRACE_MS = 10 * 60_000;

export function parseScheduledAtMs(s: string): number {
  // Accepts "YYYY-MM-DDTHH:MM:SS[.mmm]+09:00", ISO strings with Z/offset,
  // and legacy "YYYY-MM-DD HH:MM:SS" (JST implied when no zone is present).
  const t = s.replace(' ', 'T');
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(t);
  return new Date(hasZone ? t : `${t}+09:00`).getTime();
}

// Scheduled posts landing on the same (or a nearby) slot all fire on the same
// cron tick and read as a spam burst on the timeline. Resolve the requested
// slot against the account's existing scheduled posts, bumping in 1h steps
// until clear. With rollStale, a slot already in the past is pushed to the
// near future instead of firing immediately (used when approving old drafts).
export async function resolveFreeSlot(
  db: D1Database,
  xAccountId: string,
  requestedAt: string,
  opts: { rollStale?: boolean } = {},
): Promise<string> {
  const requestedMs = parseScheduledAtMs(requestedAt);
  if (Number.isNaN(requestedMs)) return requestedAt;
  let slotMs = requestedMs;
  if (opts.rollStale && slotMs <= Date.now()) slotMs = Date.now() + STALE_GRACE_MS;
  const taken = (await getScheduledPosts(db, { status: 'scheduled', xAccountId }))
    .map((p) => parseScheduledAtMs(p.scheduled_at))
    .filter((t) => !Number.isNaN(t));
  while (taken.some((t) => Math.abs(t - slotMs) < SLOT_CONFLICT_WINDOW_MS)) {
    slotMs += SLOT_BUMP_MS;
  }
  // Untouched slot keeps its original string form (format contract with callers).
  return slotMs === requestedMs ? requestedAt : toJstString(new Date(slotMs));
}

export async function getDueScheduledPosts(db: D1Database): Promise<DbScheduledPost[]> {
  const now = jstNow();
  const result = await db
    .prepare("SELECT * FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC")
    .bind(now)
    .all<DbScheduledPost>();
  return result.results;
}

export async function updateScheduledPostStatus(db: D1Database, id: string, status: string, postedTweetId?: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE scheduled_posts SET status = ?, posted_tweet_id = ?, updated_at = ? WHERE id = ?')
    .bind(status, postedTweetId ?? null, now, id)
    .run();
}

export async function deleteScheduledPost(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM scheduled_posts WHERE id = ?').bind(id).run();
}
