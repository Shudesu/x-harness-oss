import { jstNow } from './utils.js';

export interface DbGrowthDraft {
  id: string;
  x_account_id: string;
  type: string;
  text: string;
  quote_tweet_id: string | null;
  scheduled_at: string;
  status: string;
  scheduled_post_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createGrowthDraft(
  db: D1Database,
  d: { xAccountId: string; type: string; text: string; quoteTweetId?: string; scheduledAt: string },
): Promise<DbGrowthDraft> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      'INSERT INTO growth_drafts (id, x_account_id, type, text, quote_tweet_id, scheduled_at, status, scheduled_post_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(id, d.xAccountId, d.type, d.text, d.quoteTweetId ?? null, d.scheduledAt, 'pending', null, now, now)
    .first<DbGrowthDraft>();
  return result!;
}

export async function getGrowthDrafts(
  db: D1Database,
  opts: { status?: string; xAccountId?: string } = {},
): Promise<DbGrowthDraft[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) { conditions.push('status = ?'); binds.push(opts.status); }
  if (opts.xAccountId) { conditions.push('x_account_id = ?'); binds.push(opts.xAccountId); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM growth_drafts ${where} ORDER BY scheduled_at ASC`)
    .bind(...binds)
    .all<DbGrowthDraft>();
  return result.results;
}

export async function getGrowthDraft(db: D1Database, id: string): Promise<DbGrowthDraft | null> {
  const result = await db
    .prepare('SELECT * FROM growth_drafts WHERE id = ?')
    .bind(id)
    .first<DbGrowthDraft>();
  return result ?? null;
}

export async function updateGrowthDraft(
  db: D1Database,
  id: string,
  patch: { text?: string; scheduledAt?: string },
): Promise<void> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now];
  if (patch.text !== undefined) { sets.push('text = ?'); binds.push(patch.text); }
  if (patch.scheduledAt !== undefined) { sets.push('scheduled_at = ?'); binds.push(patch.scheduledAt); }
  // Reorder: SET clauses need id at end
  await db
    .prepare(`UPDATE growth_drafts SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
}

export async function setGrowthDraftStatus(
  db: D1Database,
  id: string,
  status: string,
  scheduledPostId?: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE growth_drafts SET status = ?, scheduled_post_id = ?, updated_at = ? WHERE id = ?')
    .bind(status, scheduledPostId ?? null, now, id)
    .run();
}

export async function upsertGrowthDigest(db: D1Database, date: string, payload: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      'INSERT INTO growth_digests (date, payload, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET payload = excluded.payload',
    )
    .bind(date, payload, now)
    .run();
}

export async function getLatestGrowthDigest(db: D1Database): Promise<{ date: string; payload: string } | null> {
  const result = await db
    .prepare('SELECT date, payload FROM growth_digests ORDER BY date DESC LIMIT 1')
    .first<{ date: string; payload: string }>();
  return result ?? null;
}

export async function getGrowthDigestByDate(db: D1Database, date: string): Promise<{ date: string; payload: string } | null> {
  const result = await db
    .prepare('SELECT date, payload FROM growth_digests WHERE date = ?')
    .bind(date)
    .first<{ date: string; payload: string }>();
  return result ?? null;
}
