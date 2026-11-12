import { jstNow } from './utils.js';
import { parseScheduledAtMs } from './posts.js';

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
  /** Set when an expired pending draft was archived (migration 024). */
  archived_at?: string | null;
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

// Missing archived_at column = DB before migration 024 (nothing archived yet).
function isMissingArchiveColumn(err: unknown): boolean {
  return err instanceof Error && /no such column/i.test(err.message) && /archived_at/i.test(err.message);
}

/**
 * List drafts. `status: 'pending'` means the live approval queue and skips
 * archived drafts; `status: 'archived'` lists archived (still-pending) drafts.
 */
export async function getGrowthDrafts(
  db: D1Database,
  opts: { status?: string; xAccountId?: string } = {},
): Promise<DbGrowthDraft[]> {
  const run = async (withArchive: boolean) => {
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (opts.status === 'archived') {
      conditions.push("status = 'pending'", 'archived_at IS NOT NULL');
    } else if (opts.status) {
      conditions.push('status = ?');
      binds.push(opts.status);
      if (opts.status === 'pending' && withArchive) conditions.push('archived_at IS NULL');
    }
    if (opts.xAccountId) { conditions.push('x_account_id = ?'); binds.push(opts.xAccountId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db
      .prepare(`SELECT * FROM growth_drafts ${where} ORDER BY scheduled_at ASC`)
      .bind(...binds)
      .all<DbGrowthDraft>();
    return result.results;
  };
  try {
    return await run(true);
  } catch (err) {
    if (!isMissingArchiveColumn(err)) throw err;
    return opts.status === 'archived' ? [] : run(false);
  }
}

// D1 bounds bound parameters per statement; stay well under it.
const ARCHIVE_CHUNK = 90;

/** Start of the given day in JST as an ISO string with +09:00 offset. */
export function jstDayStart(now: Date = new Date()): string {
  const day = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return `${day}T00:00:00+09:00`;
}

/**
 * Archive pending drafts whose scheduled time is before `before` (default:
 * start of today JST). Nothing is deleted and status stays 'pending'; only
 * archived_at is set, so unarchiveGrowthDrafts() restores them exactly.
 * dryRun returns the would-be count without writing.
 */
export async function archiveExpiredGrowthDrafts(
  db: D1Database,
  opts: { before?: string; xAccountId?: string; dryRun?: boolean; now?: Date } = {},
): Promise<{ count: number; archivedAt: string | null; before: string }> {
  const before = opts.before ?? jstDayStart(opts.now);
  // Zone-less legacy timestamps are JST (same rule as scheduled posts).
  const cutoff = parseScheduledAtMs(before);
  if (Number.isNaN(cutoff)) throw new Error('invalid before');
  const pending = await getGrowthDrafts(db, { status: 'pending', xAccountId: opts.xAccountId });
  const expired = pending.filter((d) => {
    const t = parseScheduledAtMs(d.scheduled_at);
    return !Number.isNaN(t) && t < cutoff;
  });
  if (opts.dryRun || expired.length === 0) return { count: expired.length, archivedAt: null, before };
  const archivedAt = new Date(opts.now ?? Date.now()).toISOString();
  // Match (id, scheduled_at) from the snapshot: a draft rescheduled in the
  // meantime (e.g. moved to today) is left alone.
  const PAIRS = ARCHIVE_CHUNK / 2;
  const stmts = [];
  for (let i = 0; i < expired.length; i += PAIRS) {
    const chunk = expired.slice(i, i + PAIRS);
    stmts.push(
      db
        .prepare(
          `UPDATE growth_drafts SET archived_at = ? WHERE status = 'pending' AND archived_at IS NULL AND (id, scheduled_at) IN (VALUES ${chunk.map(() => '(?, ?)').join(', ')})`,
        )
        .bind(archivedAt, ...chunk.flatMap((d) => [d.id, d.scheduled_at])),
    );
  }
  const results = await db.batch(stmts);
  const count = results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  return { count, archivedAt, before };
}

/**
 * Undo an archive: by batch (`archivedAt` from archiveExpiredGrowthDrafts),
 * by ids, or everything with `all`. Returns how many drafts came back.
 */
export async function unarchiveGrowthDrafts(
  db: D1Database,
  opts: { archivedAt?: string; ids?: string[]; all?: boolean },
): Promise<number> {
  if (opts.ids && opts.ids.length > 0) {
    const stmts = [];
    for (let i = 0; i < opts.ids.length; i += ARCHIVE_CHUNK) {
      const chunk = opts.ids.slice(i, i + ARCHIVE_CHUNK);
      stmts.push(
        db
          .prepare(`UPDATE growth_drafts SET archived_at = NULL WHERE archived_at IS NOT NULL AND id IN (${chunk.map(() => '?').join(', ')})`)
          .bind(...chunk),
      );
    }
    const results = await db.batch(stmts);
    return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  }
  if (opts.archivedAt) {
    const r = await db.prepare('UPDATE growth_drafts SET archived_at = NULL WHERE archived_at = ?').bind(opts.archivedAt).run();
    return r.meta?.changes ?? 0;
  }
  if (opts.all) {
    const r = await db.prepare('UPDATE growth_drafts SET archived_at = NULL WHERE archived_at IS NOT NULL').run();
    return r.meta?.changes ?? 0;
  }
  return 0;
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
  // A reschedule is an explicit decision: if a bulk archive slipped in after
  // the caller's check, un-archive so the edited draft stays in the queue.
  const withArchive = patch.scheduledAt !== undefined ? [...sets, 'archived_at = NULL'] : sets;
  try {
    await db
      .prepare(`UPDATE growth_drafts SET ${withArchive.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  } catch (err) {
    if (withArchive === sets || !isMissingArchiveColumn(err)) throw err;
    await db
      .prepare(`UPDATE growth_drafts SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }
}

export async function setGrowthDraftStatus(
  db: D1Database,
  id: string,
  status: string,
  scheduledPostId?: string,
): Promise<void> {
  const now = jstNow();
  // Leaving 'pending' also clears archived_at: if an approve/reject raced a
  // bulk archive, the explicit decision wins and the row stays consistent.
  try {
    await db
      .prepare('UPDATE growth_drafts SET status = ?, scheduled_post_id = ?, updated_at = ?, archived_at = CASE WHEN ? = \'pending\' THEN archived_at ELSE NULL END WHERE id = ?')
      .bind(status, scheduledPostId ?? null, now, status, id)
      .run();
  } catch (err) {
    if (!isMissingArchiveColumn(err)) throw err;
    await db
      .prepare('UPDATE growth_drafts SET status = ?, scheduled_post_id = ?, updated_at = ? WHERE id = ?')
      .bind(status, scheduledPostId ?? null, now, id)
      .run();
  }
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
