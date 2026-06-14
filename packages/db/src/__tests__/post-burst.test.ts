import { describe, it, expect } from 'vitest';
import { recordPostEvent, countRecentPosts } from '../post-burst.js';

// ---------------------------------------------------------------------------
// Mock D1 — captures the SQL + bound args, returns a canned `.first()` result.
// ---------------------------------------------------------------------------
interface Captured {
  sql: string;
  args: unknown[];
}

function mockDb(firstResult: unknown, captured: Captured[]) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          captured.push({ sql, args });
          return {
            first: async () => firstResult,
            run: async () => ({ success: true }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// recordPostEvent
// ---------------------------------------------------------------------------
describe('recordPostEvent', () => {
  it('inserts one row with account, a JST timestamp, and default kind=immediate', async () => {
    const captured: Captured[] = [];
    await recordPostEvent(mockDb(null, captured), 'acc-1');

    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('INSERT INTO post_burst_log');
    const [id, accountId, postedAt, kind] = captured[0].args as string[];
    expect(typeof id).toBe('string');
    expect(accountId).toBe('acc-1');
    expect(postedAt).toMatch(/\+09:00$/); // JST ISO format
    expect(kind).toBe('immediate');
  });

  it('records an explicit kind (scheduled)', async () => {
    const captured: Captured[] = [];
    await recordPostEvent(mockDb(null, captured), 'acc-1', 'scheduled');
    expect((captured[0].args as string[])[3]).toBe('scheduled');
  });
});

// ---------------------------------------------------------------------------
// countRecentPosts
// ---------------------------------------------------------------------------
describe('countRecentPosts', () => {
  it('returns the COUNT and queries by account + a JST cutoff', async () => {
    const captured: Captured[] = [];
    const n = await countRecentPosts(mockDb({ n: 5 }, captured), 'acc-1', 10);

    expect(n).toBe(5);
    expect(captured[0].sql).toContain('COUNT(*)');
    const [accountId, cutoff] = captured[0].args as string[];
    expect(accountId).toBe('acc-1');
    expect(cutoff).toMatch(/\+09:00$/);
  });

  it('returns 0 when no row is returned', async () => {
    const n = await countRecentPosts(mockDb(null, []), 'acc-1', 10);
    expect(n).toBe(0);
  });

  it('a larger window yields an earlier cutoff (lexicographically before)', async () => {
    const c10: Captured[] = [];
    const c60: Captured[] = [];
    await countRecentPosts(mockDb({ n: 0 }, c10), 'a', 10);
    await countRecentPosts(mockDb({ n: 0 }, c60), 'a', 60);

    const cutoff10 = (c10[0].args as string[])[1];
    const cutoff60 = (c60[0].args as string[])[1];
    // 60-min-ago is earlier in time, and the fixed-width JST ISO format makes
    // string ordering match chronological ordering.
    expect(cutoff60 < cutoff10).toBe(true);
  });
});
