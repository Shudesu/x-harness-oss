import { describe, it, expect, vi, beforeEach } from 'vitest';

const createScheduledPost = vi.fn(async (...args: any[]) => ({
  id: 'sp1', x_account_id: 'acc1', text: 't', media_ids: null,
  quote_tweet_id: args[5] ?? null, scheduled_at: '2026-07-12 08:00:00',
  status: 'scheduled', posted_tweet_id: null, created_at: '', updated_at: '',
}));
vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createScheduledPost: (...a: any[]) => createScheduledPost(...a),
  getXAccountById: vi.fn(async () => ({ id: 'acc1', consumer_key: null, consumer_secret: null, access_token: 'tok', access_token_secret: null })),
}));

import { posts } from '../posts.js';

describe('POST /api/posts/schedule', () => {
  beforeEach(() => createScheduledPost.mockClear());

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
});
