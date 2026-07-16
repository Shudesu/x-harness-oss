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
});
