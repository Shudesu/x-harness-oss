import { describe, it, expect } from 'vitest';
import { EngagementCache, fetchNewReplies, checkConditions } from '../reply-trigger-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockXClient(overrides: Record<string, any> = {}) {
  return {
    getLikingUsers: async () => ({ data: [] }),
    getRetweetedBy: async () => ({ data: [] }),
    getFollowers: async () => ({ data: [] }),
    searchRecentTweets: async () => ({ data: [], includes: { users: [] } }),
    ...overrides,
  } as any;
}

function createMockGate(overrides: Record<string, any> = {}) {
  return {
    id: 'gate-1',
    post_id: 'post-123',
    x_account_id: 'acc-1',
    trigger_type: 'reply',
    action_type: 'verify_only',
    require_like: 0,
    require_repost: 0,
    require_follow: 0,
    reply_keyword: null,
    last_reply_since_id: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// EngagementCache
// ---------------------------------------------------------------------------

describe('EngagementCache', () => {
  it('getLikingUsers returns cached results on second call', async () => {
    let callCount = 0;
    const xClient = createMockXClient({
      getLikingUsers: async () => {
        callCount++;
        return { data: [{ id: 'u1', name: 'Alice', username: 'alice' }] };
      },
    });

    const cache = new EngagementCache();
    const first = await cache.getLikingUsers(xClient, 'post-1');
    const second = await cache.getLikingUsers(xClient, 'post-1');

    expect(first).toEqual([{ id: 'u1', name: 'Alice', username: 'alice' }]);
    expect(second).toBe(first); // same reference
    expect(callCount).toBe(1);
  });

  it('getRetweetedBy returns cached results on second call', async () => {
    let callCount = 0;
    const xClient = createMockXClient({
      getRetweetedBy: async () => {
        callCount++;
        return { data: [{ id: 'u2', name: 'Bob', username: 'bob' }] };
      },
    });

    const cache = new EngagementCache();
    const first = await cache.getRetweetedBy(xClient, 'post-1');
    const second = await cache.getRetweetedBy(xClient, 'post-1');

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(callCount).toBe(1);
  });

  it('getFollowerIds returns Set of IDs, cached on second call', async () => {
    let callCount = 0;
    const xClient = createMockXClient({
      getFollowers: async () => {
        callCount++;
        return { data: [{ id: 'f1', name: 'F1', username: 'f1' }, { id: 'f2', name: 'F2', username: 'f2' }] };
      },
    });

    const cache = new EngagementCache();
    const first = await cache.getFollowerIds(xClient, 'user-1');
    const second = await cache.getFollowerIds(xClient, 'user-1');

    expect(first).toBeInstanceOf(Set);
    expect(first.has('f1')).toBe(true);
    expect(first.has('f2')).toBe(true);
    expect(second).toBe(first);
    expect(callCount).toBe(1);
  });

  it('fetchAllPages paginates correctly', async () => {
    let page = 0;
    const xClient = createMockXClient({
      getLikingUsers: async (_postId: string, token?: string) => {
        page++;
        if (page === 1) {
          return {
            data: [{ id: 'u1', name: 'A', username: 'a' }],
            meta: { next_token: 'page2' },
          };
        }
        return {
          data: [{ id: 'u2', name: 'B', username: 'b' }],
        };
      },
    });

    const cache = new EngagementCache();
    const result = await cache.getLikingUsers(xClient, 'post-1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('u1');
    expect(result[1].id).toBe('u2');
    expect(page).toBe(2);
  });

  it('onApiCall fires once per page with the endpoint name', async () => {
    let page = 0;
    const xClient = createMockXClient({
      getFollowers: async () => {
        page++;
        if (page < 3) {
          return { data: [{ id: `f${page}`, name: 'F', username: `f${page}` }], meta: { next_token: `p${page + 1}` } };
        }
        return { data: [{ id: 'f3', name: 'F', username: 'f3' }] };
      },
    });

    const calls: string[] = [];
    const cache = new EngagementCache((ep) => calls.push(ep));
    await cache.getFollowerIds(xClient, 'user-1');

    // Follower crawls are capped to the newest page (billed per returned item)
    expect(calls).toEqual(['verify_get_followers']);
    expect(page).toBe(1);
  });

  it('onApiCall does not fire on cache hits', async () => {
    const xClient = createMockXClient({
      getLikingUsers: async () => ({ data: [{ id: 'u1', name: 'A', username: 'a' }] }),
    });

    const calls: string[] = [];
    const cache = new EngagementCache((ep) => calls.push(ep));
    await cache.getLikingUsers(xClient, 'post-1');
    await cache.getLikingUsers(xClient, 'post-1');

    expect(calls).toEqual(['verify_get_liking_users']);
  });

  it('onApiCall tracks distinct endpoints per method', async () => {
    const xClient = createMockXClient({
      getRetweetedBy: async () => ({ data: [{ id: 'u1', name: 'A', username: 'a' }] }),
      getFollowers: async () => ({ data: [{ id: 'f1', name: 'F', username: 'f1' }] }),
    });

    const calls: string[] = [];
    const cache = new EngagementCache((ep) => calls.push(ep));
    await cache.getRetweetedBy(xClient, 'post-1');
    await cache.getFollowerIds(xClient, 'user-1');

    expect(calls).toEqual(['verify_get_retweeted_by', 'verify_get_followers']);
  });
});

// ---------------------------------------------------------------------------
// fetchNewReplies
// ---------------------------------------------------------------------------

describe('fetchNewReplies', () => {
  it('returns empty when no replies', async () => {
    const xClient = createMockXClient({
      searchRecentTweets: async () => ({ data: [], includes: { users: [] } }),
    });

    const result = await fetchNewReplies(xClient, createMockGate());
    expect(result.users).toEqual([]);
    expect(result.newestId).toBeNull();
  });

  it('extracts unique users from reply search results', async () => {
    const xClient = createMockXClient({
      searchRecentTweets: async () => ({
        data: [
          { id: 't1', author_id: 'u1' },
          { id: 't2', author_id: 'u2' },
          { id: 't3', author_id: 'u1' }, // duplicate
        ],
        includes: {
          users: [
            { id: 'u1', username: 'alice', name: 'Alice' },
            { id: 'u2', username: 'bob', name: 'Bob' },
          ],
        },
      }),
    });

    const result = await fetchNewReplies(xClient, createMockGate());
    expect(result.users).toHaveLength(2);
    expect(result.users.map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('returns newestId as the highest tweet ID', async () => {
    const xClient = createMockXClient({
      searchRecentTweets: async () => ({
        data: [
          { id: '100', author_id: 'u1' },
          { id: '300', author_id: 'u2' },
          { id: '200', author_id: 'u3' },
        ],
        includes: { users: [] },
      }),
    });

    const result = await fetchNewReplies(xClient, createMockGate());
    expect(result.newestId).toBe('300');
  });

  it('passes sinceId to searchRecentTweets when gate has last_reply_since_id', async () => {
    let capturedSinceId: string | undefined;
    const xClient = createMockXClient({
      searchRecentTweets: async (query: string, sinceId?: string) => {
        capturedSinceId = sinceId;
        return { data: [] };
      },
    });

    await fetchNewReplies(xClient, createMockGate({ last_reply_since_id: 'since-999' }));
    expect(capturedSinceId).toBe('since-999');
  });

  it('includes reply_keyword in search query when gate has one', async () => {
    let capturedQuery = '';
    const xClient = createMockXClient({
      searchRecentTweets: async (query: string) => {
        capturedQuery = query;
        return { data: [] };
      },
    });

    await fetchNewReplies(xClient, createMockGate({ reply_keyword: 'hello' }));
    expect(capturedQuery).toContain('"hello"');
    expect(capturedQuery).toContain('conversation_id:post-123');
    expect(capturedQuery).toContain('is:reply');
  });
});

// ---------------------------------------------------------------------------
// checkConditions
// ---------------------------------------------------------------------------

describe('checkConditions', () => {
  it('returns all true when no require_* flags set', async () => {
    const xClient = createMockXClient();
    const cache = new EngagementCache();
    const gate = createMockGate({ require_like: 0, require_repost: 0, require_follow: 0 });

    const result = await checkConditions(xClient, cache, gate, 'user-1', 'account-user-1');
    expect(result).toEqual({ reply: true, like: true, repost: true, follow: true });
  });

  it('checks like condition when require_like is set', async () => {
    const xClient = createMockXClient({
      getLikingUsers: async () => ({
        data: [{ id: 'other-user', name: 'Other', username: 'other' }],
      }),
    });
    const cache = new EngagementCache();
    const gate = createMockGate({ require_like: 1 });

    // User NOT in likers
    const result = await checkConditions(xClient, cache, gate, 'user-1', 'account-user-1');
    expect(result.like).toBe(false);

    // Clear cache and test with user IN likers
    const cache2 = new EngagementCache();
    const xClient2 = createMockXClient({
      getLikingUsers: async () => ({
        data: [{ id: 'user-1', name: 'Me', username: 'me' }],
      }),
    });
    const result2 = await checkConditions(xClient2, cache2, gate, 'user-1', 'account-user-1');
    expect(result2.like).toBe(true);
  });

  it('checks repost condition when require_repost is set', async () => {
    const xClient = createMockXClient({
      getRetweetedBy: async () => ({
        data: [{ id: 'user-1', name: 'Me', username: 'me' }],
      }),
    });
    const cache = new EngagementCache();
    const gate = createMockGate({ require_repost: 1 });

    const result = await checkConditions(xClient, cache, gate, 'user-1', 'account-user-1');
    expect(result.repost).toBe(true);
  });

  it('checks follow condition when require_follow is set', async () => {
    const xClient = createMockXClient({
      getFollowers: async () => ({
        data: [{ id: 'user-1', name: 'Me', username: 'me' }],
      }),
    });
    const cache = new EngagementCache();
    const gate = createMockGate({ require_follow: 1 });

    const result = await checkConditions(xClient, cache, gate, 'user-1', 'account-user-1');
    expect(result.follow).toBe(true);
  });

  it('returns false for unmet conditions', async () => {
    const xClient = createMockXClient({
      getLikingUsers: async () => ({ data: [] }),
      getRetweetedBy: async () => ({ data: [] }),
      getFollowers: async () => ({ data: [] }),
    });
    const cache = new EngagementCache();
    const gate = createMockGate({
      require_like: 1,
      require_repost: 1,
      require_follow: 1,
    });

    const result = await checkConditions(xClient, cache, gate, 'user-1', 'account-user-1');
    expect(result.like).toBe(false);
    expect(result.repost).toBe(false);
    expect(result.follow).toBe(false);
    // reply is always true (checked separately)
    expect(result.reply).toBe(true);
  });
});
