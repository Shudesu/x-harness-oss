import { jstNow, toJstString } from './utils.js';

export type PostKind = 'immediate' | 'scheduled';

/**
 * Record an actual tweet creation so the burst guard can measure posting
 * velocity. Called after a successful create_tweet. (Issue #3233)
 *
 * This must be awaited (not deferred via waitUntil) on the immediate-post path
 * so that a sequential posting loop — the shape of the 2026-06-11 13連発 — sees
 * the previous post's row when it counts before firing the next one.
 */
export async function recordPostEvent(
  db: D1Database,
  xAccountId: string,
  kind: PostKind = 'immediate',
): Promise<void> {
  await db
    .prepare('INSERT INTO post_burst_log (id, x_account_id, posted_at, kind) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), xAccountId, jstNow(), kind)
    .run();
}

/**
 * Count how many posts the account made within the last `windowMinutes`.
 *
 * Uses lexicographic comparison on JST ISO timestamps. jstNow()/toJstString()
 * emit a fixed-width `YYYY-MM-DDTHH:mm:ss.SSS+09:00` string, so string ordering
 * matches chronological ordering as long as every row is written with the same
 * formatter (recordPostEvent is the only writer).
 */
export async function countRecentPosts(
  db: D1Database,
  xAccountId: string,
  windowMinutes: number,
): Promise<number> {
  const cutoff = toJstString(new Date(Date.now() - windowMinutes * 60_000));
  const row = await db
    .prepare('SELECT COUNT(*) as n FROM post_burst_log WHERE x_account_id = ? AND posted_at >= ?')
    .bind(xAccountId, cutoff)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
