import { describe, it, expect, vi } from 'vitest';
import { processScheduledPosts } from '../post-scheduler.js';

function mockDb(duePosts: any[]) {
  const run = vi.fn();
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: duePosts })),
        first: vi.fn(async () => duePosts[0] ?? null),
        run,
      })),
    })),
    _run: run,
  } as any;
}

describe('processScheduledPosts', () => {
  it('passes quote_tweet_id to createTweet when set', async () => {
    const db = mockDb([{
      id: 'sp1', x_account_id: 'acc1', text: 'quote post',
      media_ids: null, quote_tweet_id: '1234567890',
      scheduled_at: '2026-07-11 08:00:00', status: 'scheduled',
      posted_tweet_id: null, created_at: '', updated_at: '',
    }]);
    const xClient = { createTweet: vi.fn(async () => ({ id: 'tw1', text: 'quote post' })) } as any;
    await processScheduledPosts(db, xClient);
    expect(xClient.createTweet).toHaveBeenCalledWith({
      text: 'quote post',
      media: undefined,
      quote_tweet_id: '1234567890',
    });
  });

  it('omits quote_tweet_id when null', async () => {
    const db = mockDb([{
      id: 'sp2', x_account_id: 'acc1', text: 'plain post',
      media_ids: null, quote_tweet_id: null,
      scheduled_at: '2026-07-11 08:00:00', status: 'scheduled',
      posted_tweet_id: null, created_at: '', updated_at: '',
    }]);
    const xClient = { createTweet: vi.fn(async () => ({ id: 'tw2', text: 'plain post' })) } as any;
    await processScheduledPosts(db, xClient);
    expect(xClient.createTweet).toHaveBeenCalledWith({
      text: 'plain post',
      media: undefined,
      quote_tweet_id: undefined,
    });
  });

  it('fails an over-limit post for a non-Premium account without calling X', async () => {
    const db = mockDb([{
      id: 'sp3', x_account_id: 'acc1', text: 'あ'.repeat(141),
      media_ids: null, quote_tweet_id: null,
      scheduled_at: '2026-07-11 08:00:00', status: 'scheduled',
      posted_tweet_id: null, created_at: '', updated_at: '',
    }]);
    const xClient = {
      createTweet: vi.fn(),
      getMeWithSubscription: vi.fn(async () => ({ subscription_type: 'None' })),
    } as any;
    await processScheduledPosts(db, xClient);
    expect(xClient.createTweet).not.toHaveBeenCalled();
    expect(db.prepare.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE scheduled_posts'))).toBe(true);
    // Known-unsent: the claim must be released so requeue doesn't demand confirmNotPosted.
    expect(db.prepare.mock.calls.some(([sql]: [string]) => sql.includes('DELETE FROM scheduled_post_claims'))).toBe(true);
  });

  it('sends a long post in full for a Premium account', async () => {
    const text = 'あ'.repeat(1000);
    const db = mockDb([{
      id: 'sp4', x_account_id: 'acc1', text,
      media_ids: null, quote_tweet_id: null,
      scheduled_at: '2026-07-11 08:00:00', status: 'scheduled',
      posted_tweet_id: null, created_at: '', updated_at: '',
    }]);
    const xClient = {
      createTweet: vi.fn(async () => ({ id: 'tw4', text })),
      getMeWithSubscription: vi.fn(async () => ({ subscription_type: 'Premium' })),
    } as any;
    await processScheduledPosts(db, xClient);
    expect(xClient.createTweet).toHaveBeenCalledWith(expect.objectContaining({ text }));
  });
});
