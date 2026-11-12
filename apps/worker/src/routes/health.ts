import { APP_VERSION } from '@x-harness/shared';
import { Hono } from 'hono';
import { jstNow, toJstString } from '@x-harness/db';
import type { Env } from '../index.js';

const health = new Hono<Env>();

health.get('/api/health', (c) => {
  return c.json({ success: true, data: { status: 'ok', version: APP_VERSION } });
});

// A 'scheduled' post this far past its slot should have been picked up already.
const OVERDUE_GRACE_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

async function countWhere(db: D1Database, sql: string, ...binds: unknown[]): Promise<number | null> {
  try {
    const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return null;
  }
}

// GET /api/health/details — authenticated operational summary for the
// dashboard: are scheduled posts going out, and did any fail recently?
health.get('/api/health/details', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const problems: string[] = [];
  try {
    await db.prepare('SELECT 1').first();
  } catch {
    return c.json({ success: true, data: { status: 'down', version: APP_VERSION, checkedAt: jstNow(), problems: ['d1_unreachable'] } }, 503);
  }

  // A query that fails (e.g. incomplete schema) is reported, never read as 0.
  const known = (n: number | null, what: string): number => {
    if (n === null) problems.push(`query_failed:${what}`);
    return n ?? 0;
  };
  const overdue = known(await countWhere(
    db,
    "SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_at <= ?",
    toJstString(new Date(now - OVERDUE_GRACE_MS)),
  ), 'overdue');
  if (overdue > 0) problems.push('scheduled_posts_overdue');

  const since = toJstString(new Date(now - DAY_MS));
  const failed24h = known(await countWhere(db, "SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'failed' AND updated_at >= ?", since), 'failed_24h');
  const posted24h = known(await countWhere(db, "SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'posted' AND updated_at >= ?", since), 'posted_24h');
  if (failed24h > 0) problems.push('scheduled_posts_failed_last_24h');

  const totalsRows = await db
    .prepare('SELECT status, COUNT(*) AS n FROM scheduled_posts GROUP BY status')
    .all<{ status: string; n: number }>()
    .catch(() => null);
  if (!totalsRows) problems.push('query_failed:totals');
  const totals: Record<string, number> = {};
  for (const r of totalsRows?.results ?? []) totals[r.status] = r.n;

  const latest = await db
    .prepare("SELECT id, updated_at FROM scheduled_posts WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 1")
    .first<{ id: string; updated_at: string }>()
    .catch(() => null);

  // Archived drafts (migration 024) are out of the queue; older DBs fall back.
  const pendingDrafts =
    (await countWhere(db, "SELECT COUNT(*) AS n FROM growth_drafts WHERE status = 'pending' AND archived_at IS NULL"))
    ?? (await countWhere(db, "SELECT COUNT(*) AS n FROM growth_drafts WHERE status = 'pending'"));

  return c.json({
    success: true,
    data: {
      status: problems.length === 0 ? 'ok' : 'degraded',
      version: APP_VERSION,
      checkedAt: jstNow(),
      problems,
      scheduledPosts: {
        overdue,
        last24h: { failed: failed24h, posted: posted24h },
        totals,
        latestFailure: latest ? { id: latest.id, lastError: null, failedAt: latest.updated_at } : null,
      },
      growthDrafts: { pending: pendingDrafts },
    },
  });
});

export { health };
