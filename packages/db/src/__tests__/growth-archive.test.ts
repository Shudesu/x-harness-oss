import { describe, it, expect } from 'vitest';
import { readRepoFile, sqliteD1 } from '../../../../test-support/sqlite-d1.mjs';
import { archiveExpiredGrowthDrafts, getGrowthDraft, getGrowthDrafts, jstDayStart, setGrowthDraftStatus, unarchiveGrowthDrafts, updateGrowthDraft } from '../growth.js';

// Shape before migration 024 (from 015).
const PRE_024 = `CREATE TABLE growth_drafts (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  quote_tweet_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'rejected')),
  scheduled_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const MIGRATION_024 = readRepoFile('packages/db/migrations/024-growth-draft-archive.sql');
const NOW = new Date('2026-11-11T06:30:00Z'); // 15:30 JST

function seed(raw: any, rows: Array<{ id: string; at: string; status?: string; acc?: string }>) {
  const st = raw.prepare(
    "INSERT INTO growth_drafts (id, x_account_id, type, text, scheduled_at, status, created_at, updated_at) VALUES (?, ?, 'quote_rt', 'body', ?, ?, 'c', 'u0')",
  );
  for (const r of rows) st.run(r.id, r.acc ?? 'acc1', r.at, r.status ?? 'pending');
}

function setup() {
  const { d1, raw } = sqliteD1([PRE_024]);
  seed(raw, [
    { id: 'old1', at: '2026-07-13T08:00:00+09:00' },
    { id: 'old2', at: '2026-11-10T21:00:00+09:00' },
    { id: 'oldZ', at: '2026-11-10T14:59:00.000Z' }, // 23:59 JST on the 10th
    { id: 'today-past', at: '2026-11-11T12:00:00+09:00' },
    { id: 'today', at: '2026-11-11T21:00:00+09:00' },
    { id: 'tomorrow', at: '2026-11-12T08:00:00+09:00' },
    { id: 'rej', at: '2026-07-11T21:00:00+09:00', status: 'rejected' },
    { id: 'sched', at: '2026-07-19T12:00:00+09:00', status: 'scheduled' },
    { id: 'other', at: '2026-07-13T08:00:00+09:00', acc: 'acc2' },
  ]);
  raw.exec(MIGRATION_024);
  return { d1: d1 as any, raw: raw as any };
}

describe('jstDayStart', () => {
  it('returns JST midnight even when UTC is still the previous day', () => {
    expect(jstDayStart(new Date('2026-11-10T15:30:00Z'))).toBe('2026-11-11T00:00:00+09:00');
    expect(jstDayStart(NOW)).toBe('2026-11-11T00:00:00+09:00');
  });
});

describe('migration 024 + archive', () => {
  it('migration is additive: existing rows keep their values', () => {
    const { raw } = setup();
    const row = raw.prepare("SELECT * FROM growth_drafts WHERE id = 'old1'").get();
    expect(row.status).toBe('pending');
    expect(row.archived_at).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) n FROM growth_drafts').get().n).toBe(9);
  });

  it('dryRun counts only pending drafts scheduled before today (JST) and writes nothing', async () => {
    const { d1, raw } = setup();
    const r = await archiveExpiredGrowthDrafts(d1, { dryRun: true, now: NOW });
    expect(r).toEqual({ count: 4, archivedAt: null, before: '2026-11-11T00:00:00+09:00' });
    expect(raw.prepare('SELECT COUNT(*) n FROM growth_drafts WHERE archived_at IS NOT NULL').get().n).toBe(0);
  });

  it('archives without deleting or changing status, and hides them from the pending queue', async () => {
    const { d1, raw } = setup();
    const r = await archiveExpiredGrowthDrafts(d1, { xAccountId: 'acc1', now: NOW });
    expect(r.count).toBe(3);
    expect(r.archivedAt).toBe(NOW.toISOString());
    expect(raw.prepare('SELECT COUNT(*) n FROM growth_drafts').get().n).toBe(9);
    const archived = raw.prepare('SELECT id, status, updated_at FROM growth_drafts WHERE archived_at IS NOT NULL ORDER BY id').all();
    expect(archived.map((x: any) => x.id)).toEqual(['old1', 'old2', 'oldZ']);
    expect(archived.every((x: any) => x.status === 'pending' && x.updated_at === 'u0')).toBe(true);
    const pending = await getGrowthDrafts(d1, { status: 'pending', xAccountId: 'acc1' });
    expect(pending.map((d) => d.id)).toEqual(['today-past', 'today', 'tomorrow']);
    const listed = await getGrowthDrafts(d1, { status: 'archived' });
    expect(listed.map((d) => d.id).sort()).toEqual(['old1', 'old2', 'oldZ']);
    expect((await getGrowthDraft(d1, 'old1'))?.archived_at).toBe(NOW.toISOString());
  });

  it('skips a draft rescheduled after the snapshot was read', async () => {
    const { d1, raw } = setup();
    const realBatch = d1.batch;
    d1.batch = async (stmts: any[]) => {
      raw.prepare("UPDATE growth_drafts SET scheduled_at = '2026-11-11T20:00:00+09:00' WHERE id = 'old2'").run();
      return realBatch(stmts);
    };
    const r = await archiveExpiredGrowthDrafts(d1, { now: NOW });
    expect(r.count).toBe(3);
    expect(raw.prepare("SELECT archived_at FROM growth_drafts WHERE id = 'old2'").get().archived_at).toBeNull();
  });

  it('approve/reject clears archived_at (the explicit decision wins a race)', async () => {
    const { d1, raw } = setup();
    await archiveExpiredGrowthDrafts(d1, { now: NOW });
    await setGrowthDraftStatus(d1, 'old1', 'scheduled', 'sp1');
    const row = raw.prepare("SELECT status, archived_at FROM growth_drafts WHERE id = 'old1'").get();
    expect(row).toEqual({ status: 'scheduled', archived_at: null });
    await setGrowthDraftStatus(d1, 'old2', 'pending');
    expect(raw.prepare("SELECT archived_at FROM growth_drafts WHERE id = 'old2'").get().archived_at).not.toBeNull();
  });

  it('rescheduling clears archived_at; a text-only edit does not', async () => {
    const { d1, raw } = setup();
    await archiveExpiredGrowthDrafts(d1, { now: NOW });
    await updateGrowthDraft(d1, 'old1', { text: 'edited' });
    expect(raw.prepare("SELECT archived_at FROM growth_drafts WHERE id = 'old1'").get().archived_at).not.toBeNull();
    await updateGrowthDraft(d1, 'old1', { scheduledAt: '2026-11-12T08:00:00+09:00' });
    expect(raw.prepare("SELECT archived_at, scheduled_at FROM growth_drafts WHERE id = 'old1'").get()).toEqual({ archived_at: null, scheduled_at: '2026-11-12T08:00:00+09:00' });
    const pre = sqliteD1([PRE_024]);
    seed(pre.raw, [{ id: 'a', at: '2026-07-13T08:00:00+09:00' }]);
    await updateGrowthDraft(pre.d1 as any, 'a', { scheduledAt: '2026-11-12T08:00:00+09:00' });
    expect((pre.raw as any).prepare("SELECT scheduled_at FROM growth_drafts WHERE id = 'a'").get().scheduled_at).toBe('2026-11-12T08:00:00+09:00');
  });

  it('setGrowthDraftStatus still works before migration 024', async () => {
    const { d1, raw } = sqliteD1([PRE_024]);
    seed(raw, [{ id: 'a', at: '2026-07-13T08:00:00+09:00' }]);
    await setGrowthDraftStatus(d1 as any, 'a', 'rejected');
    expect((raw as any).prepare("SELECT status FROM growth_drafts WHERE id = 'a'").get().status).toBe('rejected');
  });

  it('a second run archives nothing new', async () => {
    const { d1 } = setup();
    await archiveExpiredGrowthDrafts(d1, { now: NOW });
    expect((await archiveExpiredGrowthDrafts(d1, { now: NOW })).count).toBe(0);
  });

  it('unarchive by batch restores the exact rows', async () => {
    const { d1, raw } = setup();
    const before = raw.prepare('SELECT * FROM growth_drafts ORDER BY id').all();
    const { archivedAt } = await archiveExpiredGrowthDrafts(d1, { now: NOW });
    expect(await unarchiveGrowthDrafts(d1, { archivedAt: archivedAt! })).toBe(4);
    expect(raw.prepare('SELECT * FROM growth_drafts ORDER BY id').all()).toEqual(before);
  });

  it('unarchive by ids and all', async () => {
    const { d1 } = setup();
    await archiveExpiredGrowthDrafts(d1, { now: NOW });
    expect(await unarchiveGrowthDrafts(d1, { ids: ['old1', 'today'] })).toBe(1);
    expect(await unarchiveGrowthDrafts(d1, { all: true })).toBe(3);
    expect(await unarchiveGrowthDrafts(d1, {})).toBe(0);
    expect((await getGrowthDrafts(d1, { status: 'pending' })).length).toBe(7);
  });

  it('rejects an invalid cutoff', async () => {
    const { d1 } = setup();
    await expect(archiveExpiredGrowthDrafts(d1, { before: 'nope' })).rejects.toThrow('invalid before');
  });

  it('pre-024 DB: pending list still works and archived list is empty', async () => {
    const { d1, raw } = sqliteD1([PRE_024]);
    seed(raw, [{ id: 'a', at: '2026-07-13T08:00:00+09:00' }]);
    expect((await getGrowthDrafts(d1 as any, { status: 'pending' })).map((d) => d.id)).toEqual(['a']);
    expect(await getGrowthDrafts(d1 as any, { status: 'archived' })).toEqual([]);
  });
});
