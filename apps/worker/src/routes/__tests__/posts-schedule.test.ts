import { describe, it, expect, vi, beforeEach } from 'vitest';

const createScheduledPost = vi.fn(async (...args: any[]) => ({
  id: 'sp1', x_account_id: 'acc1', text: 't', media_ids: null,
  quote_tweet_id: args[5] ?? null, scheduled_at: '2026-07-12 08:00:00',
  status: 'scheduled', posted_tweet_id: null, created_at: '', updated_at: '',
}));
// Pass-through by default; individual tests override to simulate a bumped slot.
const resolveFreeSlot = vi.fn(async (..._a: any[]) => _a[2] as string);
vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createScheduledPost: (...a: any[]) => createScheduledPost(...a),
  resolveFreeSlot: (...a: any[]) => resolveFreeSlot(...a),
  getXAccountById: vi.fn(async () => ({ id: 'acc1', consumer_key: null, consumer_secret: null, access_token: 'tok', access_token_secret: null })),
}));

const subscription = { type: 'None' };
const getMeWithSubscription = vi.fn(async () => ({ subscription_type: subscription.type }));
vi.mock('../../services/x-client.js', () => ({
  buildXClient: vi.fn(async () => ({ getMeWithSubscription })),
}));

// settings table stand-in for the plan cache.
function settingsDb() {
  const rows = new Map<string, string>();
  return {
    prepare: (sql: string) => ({
      bind: (...a: unknown[]) => ({
        first: async () => (sql.startsWith('SELECT') && rows.has(String(a[0])) ? { value: rows.get(String(a[0])) } : null),
        run: async () => { rows.set(String(a[0]), String(a[1])); return { success: true }; },
      }),
    }),
  };
}

import { posts } from '../posts.js';

describe('POST /api/posts/schedule', () => {
  beforeEach(() => {
    createScheduledPost.mockClear();
    resolveFreeSlot.mockClear();
  });

  it('passes quoteTweetId through to createScheduledPost', async () => {
    const req = new Request('http://local/api/posts/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1', text: 't', scheduledAt: '2026-07-12 08:00:00', quoteTweetId: '999' }),
    });
    const res = await posts.request(req, undefined, { DB: {} } as any);
    expect(res.status).toBe(201);
    expect(createScheduledPost).toHaveBeenCalledWith({}, 'acc1', 't', '2026-07-12 08:00:00', undefined, '999');
  });

  it('schedules at the conflict-resolved slot, not the requested one', async () => {
    resolveFreeSlot.mockResolvedValueOnce('2026-07-12T09:00:00.000+09:00');
    const req = new Request('http://local/api/posts/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1', text: 't', scheduledAt: '2026-07-12T08:00:00+09:00' }),
    });
    const res = await posts.request(req, undefined, { DB: {} } as any);
    expect(res.status).toBe(201);
    // No rollStale here: schedule-in-the-past means "post ASAP" on this route.
    expect(resolveFreeSlot).toHaveBeenCalledWith({}, 'acc1', '2026-07-12T08:00:00+09:00');
    expect(createScheduledPost).toHaveBeenCalledWith({}, 'acc1', 't', '2026-07-12T09:00:00.000+09:00', undefined, undefined);
  });

  it('rejects text over 280 for a non-Premium account (TEXT_TOO_LONG) without scheduling', async () => {
    subscription.type = 'None';
    const req = new Request('http://local/api/posts/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1', text: 'あ'.repeat(141), scheduledAt: '2026-07-12 08:00:00' }),
    });
    const res = await posts.request(req, undefined, { DB: settingsDb() } as any);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.code).toBe('TEXT_TOO_LONG');
    expect(json.data).toMatchObject({ weightedLength: 282, limit: 280, plan: 'None' });
    expect(createScheduledPost).not.toHaveBeenCalled();
  });

  it('schedules a long post unchanged for a Premium account', async () => {
    subscription.type = 'Premium';
    const text = 'あ'.repeat(2000);
    const req = new Request('http://local/api/posts/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1', text, scheduledAt: '2026-07-12 08:00:00' }),
    });
    const db = settingsDb();
    const res = await posts.request(req, undefined, { DB: db } as any);
    expect(res.status).toBe(201);
    expect(createScheduledPost).toHaveBeenCalledWith(db, 'acc1', text, '2026-07-12 08:00:00', undefined, undefined);
  });
});
