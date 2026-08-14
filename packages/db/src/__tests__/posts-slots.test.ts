import { describe, it, expect } from 'vitest';
import { parseScheduledAtMs, resolveFreeSlot } from '../posts.js';

// Minimal D1 stub: getScheduledPosts only needs prepare().bind().all().
function stubDb(scheduledAts: string[]): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: scheduledAts.map((s) => ({ scheduled_at: s })) }),
      }),
    }),
  } as unknown as D1Database;
}

const HOUR = 60 * 60_000;

describe('parseScheduledAtMs', () => {
  it('parses planner format (naive JST with +09:00)', () => {
    expect(parseScheduledAtMs('2026-07-20T08:00:00+09:00')).toBe(Date.parse('2026-07-19T23:00:00Z'));
  });

  it('parses legacy space format as JST', () => {
    expect(parseScheduledAtMs('2026-07-20 08:00:00')).toBe(Date.parse('2026-07-19T23:00:00Z'));
  });

  it('does NOT reinterpret a genuine UTC (Z) timestamp as JST wall time', () => {
    expect(parseScheduledAtMs('2026-07-20T08:00:00Z')).toBe(Date.parse('2026-07-20T08:00:00Z'));
  });

  it('handles milliseconds', () => {
    expect(parseScheduledAtMs('2026-07-20T08:00:00.500+09:00')).toBe(Date.parse('2026-07-19T23:00:00.500Z'));
  });
});

describe('resolveFreeSlot', () => {
  const FUTURE = '2099-01-01T08:00:00+09:00';

  it('keeps a free future slot in its original string form', async () => {
    expect(await resolveFreeSlot(stubDb([]), 'acc1', FUTURE)).toBe(FUTURE);
  });

  it('bumps by 1h steps off a claimed slot', async () => {
    const got = await resolveFreeSlot(stubDb([FUTURE]), 'acc1', FUTURE);
    expect(new Date(got).getTime() - parseScheduledAtMs(FUTURE)).toBe(HOUR);
  });

  it('bumps past a chain of adjacent claimed slots', async () => {
    const plus1h = '2099-01-01T09:00:00+09:00';
    const got = await resolveFreeSlot(stubDb([FUTURE, plus1h]), 'acc1', FUTURE);
    expect(new Date(got).getTime() - parseScheduledAtMs(FUTURE)).toBe(2 * HOUR);
  });

  it('treats slots within 45min as a conflict', async () => {
    const nearby = '2099-01-01T08:30:00+09:00';
    const got = await resolveFreeSlot(stubDb([nearby]), 'acc1', FUTURE);
    expect(new Date(got).getTime()).toBeGreaterThan(parseScheduledAtMs(nearby));
  });

  it('rolls a stale slot to the near future when rollStale is set', async () => {
    const got = await resolveFreeSlot(stubDb([]), 'acc1', '2020-01-01T12:00:00+09:00', { rollStale: true });
    const ms = new Date(got).getTime();
    expect(ms).toBeGreaterThan(Date.now());
    expect(ms).toBeLessThan(Date.now() + HOUR);
  });

  it('leaves a stale slot untouched without rollStale (post-ASAP contract)', async () => {
    const stale = '2020-01-01T12:00:00+09:00';
    expect(await resolveFreeSlot(stubDb([]), 'acc1', stale)).toBe(stale);
  });

  it('returns unparseable input unchanged', async () => {
    expect(await resolveFreeSlot(stubDb([]), 'acc1', 'garbage')).toBe('garbage');
  });
});
