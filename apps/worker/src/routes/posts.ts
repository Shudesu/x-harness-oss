import { Hono } from 'hono';
import { XClient } from '@x-harness/x-sdk';
import { createScheduledPost, getScheduledPosts, deleteScheduledPost, getXAccountById, getXAccounts, incrementApiUsage, saveQuoteTweets, getQuoteTweetsByAccount, getQuoteTweetsBySource, getLatestDiscoveredAt, recordAction, getActions } from '@x-harness/db';
import type { SaveQuoteTweetInput } from '@x-harness/db';
import type { Env } from '../index.js';

const posts = new Hono<Env>();

// Helper: build XClient from account record
function buildXClient(account: { consumer_key: string | null; consumer_secret: string | null; access_token: string; access_token_secret: string | null }): XClient {
  return account.consumer_key && account.consumer_secret && account.access_token_secret
    ? new XClient({
        type: 'oauth1',
        consumerKey: account.consumer_key,
        consumerSecret: account.consumer_secret,
        accessToken: account.access_token,
        accessTokenSecret: account.access_token_secret,
      })
    : new XClient(account.access_token);
}

posts.post('/api/posts', async (c) => {
  const { xAccountId, text, mediaIds, quoteTweetId } = await c.req.json<{ xAccountId: string; text: string; mediaIds?: string[]; quoteTweetId?: string }>();
  if (!text || !xAccountId) return c.json({ success: false, error: 'Missing required fields: xAccountId, text' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    const tweet = await xClient.createTweet({
      text,
      media: mediaIds ? { media_ids: mediaIds } : undefined,
      quote_tweet_id: quoteTweetId,
    });
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'create_tweet'));
    return c.json({ success: true, data: tweet }, 201);
  } catch (err: any) {
    // X API client errors (4xx, e.g. duplicate content / rate limit) are caller-fixable —
    // surface the real status instead of flattening everything to 500, so callers like
    // x_auto_poster can distinguish "skip, X rejected this" from "our server broke".
    const status = typeof err.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    return c.json({ success: false, error: err.message ?? 'Failed to create tweet' }, status);
  }
});

posts.post('/api/posts/schedule', async (c) => {
  const { xAccountId, text, scheduledAt, mediaIds } = await c.req.json<{
    xAccountId: string; text: string; scheduledAt: string; mediaIds?: string[];
  }>();
  if (!xAccountId || !text || !scheduledAt) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, text, scheduledAt' }, 400);
  }
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const post = await createScheduledPost(c.env.DB, xAccountId, text, scheduledAt, mediaIds);
  return c.json({
    success: true,
    data: {
      id: post.id,
      xAccountId: post.x_account_id,
      text: post.text,
      mediaIds: post.media_ids ? JSON.parse(post.media_ids) : null,
      scheduledAt: post.scheduled_at,
      status: post.status,
      postedTweetId: post.posted_tweet_id,
      createdAt: post.created_at,
    },
  }, 201);
});

posts.get('/api/posts/scheduled', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const items = await getScheduledPosts(c.env.DB, { status: 'scheduled', xAccountId: xAccountId ?? undefined });
  return c.json({
    success: true,
    data: items.map((p) => ({
      id: p.id,
      xAccountId: p.x_account_id,
      text: p.text,
      mediaIds: p.media_ids ? JSON.parse(p.media_ids) : null,
      scheduledAt: p.scheduled_at,
      status: p.status,
      postedTweetId: p.posted_tweet_id,
      createdAt: p.created_at,
    })),
  });
});

posts.delete('/api/posts/scheduled/:id', async (c) => {
  await deleteScheduledPost(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// DELETE /api/posts/:tweetId — hard-delete a posted tweet via X API
//
// Refuses to delete tweets that back an active engagement gate, since
// processEngagementGates() would otherwise keep polling X for the now-missing
// post id (likes/RTs/replies). The operator must deactivate or delete the
// gate first. Pass `?force=1` to delete the tweet anyway.
posts.delete('/api/posts/:tweetId', async (c) => {
  const tweetId = c.req.param('tweetId');
  const xAccountId = c.req.query('xAccountId');
  const force = c.req.query('force') === '1';
  if (!xAccountId) return c.json({ success: false, error: 'Missing required query param: xAccountId' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);

  if (!force) {
    const linkedGates = await c.env.DB
      .prepare('SELECT id, is_active FROM engagement_gates WHERE post_id = ?')
      .bind(tweetId)
      .all<{ id: string; is_active: number }>();
    const activeLinkedGates = (linkedGates.results ?? []).filter((g) => Number(g.is_active) === 1);
    if (activeLinkedGates.length > 0) {
      return c.json(
        {
          success: false,
          error: 'tweet is referenced by an active engagement gate; deactivate or delete the gate first, or pass ?force=1',
          data: { linkedGateIds: activeLinkedGates.map((g) => g.id) },
        },
        409,
      );
    }
  }

  const xClient = buildXClient(account);
  try {
    await xClient.deleteTweet(tweetId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'delete_tweet'));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to delete tweet' }, 500);
  }
});

// POST /api/posts/thread — post a thread (sequence of replies)
posts.post('/api/posts/thread', async (c) => {
  const { xAccountId, texts } = await c.req.json<{ xAccountId: string; texts: string[] }>();
  if (!xAccountId || !texts || texts.length === 0) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, texts' }, 400);
  }
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    const results: { id: string; text: string }[] = [];
    let previousId: string | undefined;
    for (const text of texts) {
      const tweet = await xClient.createTweet({
        text,
        reply: previousId ? { in_reply_to_tweet_id: previousId } : undefined,
      });
      results.push({ id: tweet.id, text: tweet.text });
      previousId = tweet.id;
    }
    return c.json({ success: true, data: results }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to create thread' }, 500);
  }
});

// GET /api/posts/history — user's recent tweets with metrics
posts.get('/api/posts/history', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const limitParam = c.req.query('limit');
  const cursor = c.req.query('cursor');
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] || null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  const limit = limitParam ? Math.min(Number(limitParam), 100) : 20;
  try {
    const res = await xClient.getUserTweets(account.x_user_id, limit, cursor ?? undefined);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'get_user_tweets'));
    const items = res.data ?? [];
    return c.json({ success: true, data: { items, nextCursor: res.meta?.next_token ?? null } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch tweet history' }, 500);
  }
});

// GET /api/posts/mentions — replies to my tweets
posts.get('/api/posts/mentions', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const sinceId = c.req.query('sinceId');
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] || null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    const query = `to:${account.username} is:reply`;
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'search_mentions'));
    const raw = await xClient.searchRecentTweets(query, sinceId ?? undefined) as {
      data: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at?: string;
        referenced_tweets?: Array<{ type: string; id: string }>;
        public_metrics?: {
          retweet_count: number;
          reply_count: number;
          like_count: number;
          quote_count: number;
          impression_count: number;
        };
      }>;
      includes?: {
        users?: Array<{
          id: string;
          username: string;
          name: string;
          profile_image_url?: string;
        }>;
        tweets?: Array<{
          id: string;
          text: string;
          author_id: string;
          created_at?: string;
        }>;
      };
      meta?: { next_token?: string };
    };
    const usersMap = new Map<string, { username: string; name: string; profile_image_url?: string }>();
    for (const u of raw.includes?.users ?? []) {
      usersMap.set(u.id, { username: u.username, name: u.name, profile_image_url: u.profile_image_url });
    }
    const tweetsMap = new Map<string, { text: string; authorId: string }>();
    for (const tw of raw.includes?.tweets ?? []) {
      tweetsMap.set(tw.id, { text: tw.text, authorId: tw.author_id });
    }
    const data = (raw.data ?? []).map((t) => {
      const author = usersMap.get(t.author_id);
      const repliedTo = t.referenced_tweets?.find((r) => r.type === 'replied_to');
      const parentTweet = repliedTo ? tweetsMap.get(repliedTo.id) : null;
      const parentAuthor = parentTweet ? usersMap.get(parentTweet.authorId) : null;
      return {
        id: t.id,
        text: t.text,
        authorId: t.author_id,
        authorUsername: author?.username ?? null,
        authorDisplayName: author?.name ?? null,
        authorProfileImageUrl: author?.profile_image_url ?? null,
        inReplyToTweetId: repliedTo?.id ?? null,
        parentTweetText: parentTweet?.text ?? null,
        parentTweetAuthor: parentAuthor?.username ?? null,
        createdAt: t.created_at ?? null,
        publicMetrics: t.public_metrics ?? null,
        isOwnReply: false,
      };
    });

    // Fetch user's own replies to merge into the groups
    let ownReplies: typeof data = [];
    try {
      const ownQuery = `from:${account.username} is:reply`;
      c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'search_own_replies'));
      const ownRaw = await xClient.searchRecentTweets(ownQuery, sinceId ?? undefined) as typeof raw;
      const ownUsersMap = new Map<string, { username: string; name: string; profile_image_url?: string }>();
      for (const u of ownRaw.includes?.users ?? []) {
        ownUsersMap.set(u.id, { username: u.username, name: u.name, profile_image_url: u.profile_image_url });
      }
      // Collect the parent tweet IDs from the main data to filter relevant own replies
      const parentTweetIds = new Set(data.map((d) => d.inReplyToTweetId).filter(Boolean));
      const replyTweetIds = new Set(data.map((d) => d.id));

      ownReplies = (ownRaw.data ?? [])
        .filter((t) => {
          const repliedTo = t.referenced_tweets?.find((r) => r.type === 'replied_to');
          if (!repliedTo) return false;
          // Include if it's a reply to one of the parent tweets OR to one of the mention replies
          return parentTweetIds.has(repliedTo.id) || replyTweetIds.has(repliedTo.id);
        })
        .map((t) => {
          const author = ownUsersMap.get(t.author_id);
          const repliedTo = t.referenced_tweets?.find((r) => r.type === 'replied_to');
          return {
            id: t.id,
            text: t.text,
            authorId: t.author_id,
            authorUsername: author?.username ?? null,
            authorDisplayName: author?.name ?? null,
            authorProfileImageUrl: author?.profile_image_url ?? null,
            inReplyToTweetId: repliedTo?.id ?? null,
            parentTweetText: null,
            parentTweetAuthor: null,
            createdAt: t.created_at ?? null,
            publicMetrics: t.public_metrics ?? null,
            isOwnReply: true,
          };
        });
    } catch {
      // If own replies search fails, continue without them
    }

    // Merge own replies into data, avoiding duplicates
    const seenIds = new Set(data.map((d) => d.id));
    for (const ownReply of ownReplies) {
      if (!seenIds.has(ownReply.id)) {
        data.push(ownReply);
        seenIds.add(ownReply.id);
      }
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch mentions' }, 500);
  }
});

// GET /api/posts/viral-search — バズっている投資・経済・金融関連ツイートを検索する
// (x_auto_poster の3時間おきバズ分析投稿から呼ばれる想定)
posts.get('/api/posts/viral-search', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const query = c.req.query('query');
  const minLikes = Number(c.req.query('minLikes') ?? '500');
  if (!query) return c.json({ success: false, error: 'Missing required query param: query' }, 400);
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] || null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'search_viral'));
    const raw = await xClient.searchTopTweets(query) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at?: string;
        lang?: string;
        public_metrics?: { retweet_count: number; reply_count: number; like_count: number; quote_count: number; impression_count?: number };
      }>;
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    };
    const usersMap = new Map<string, { username: string; name: string }>();
    for (const u of raw.includes?.users ?? []) usersMap.set(u.id, { username: u.username, name: u.name });

    const data = (raw.data ?? [])
      .map((t) => {
        const author = usersMap.get(t.author_id);
        const metrics = t.public_metrics ?? { retweet_count: 0, reply_count: 0, like_count: 0, quote_count: 0 };
        return {
          id: t.id,
          text: t.text,
          createdAt: t.created_at ?? null,
          authorUsername: author?.username ?? null,
          authorName: author?.name ?? null,
          likeCount: metrics.like_count,
          retweetCount: metrics.retweet_count,
          replyCount: metrics.reply_count,
          quoteCount: metrics.quote_count,
          engagementScore: metrics.like_count + metrics.retweet_count * 2 + metrics.quote_count * 2,
        };
      })
      .filter((t) => t.likeCount >= minLikes)
      .sort((a, b) => b.engagementScore - a.engagementScore);

    return c.json({ success: true, data });
  } catch (err: any) {
    const status = typeof err.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    return c.json({ success: false, error: err.message ?? 'Failed to search viral tweets' }, status);
  }
});

// POST /api/posts/actions — get persisted engagement actions for tweet IDs
posts.post('/api/posts/actions', async (c) => {
  const { xAccountId, tweetIds } = await c.req.json<{ xAccountId: string; tweetIds: string[] }>();
  if (!xAccountId || !tweetIds || !Array.isArray(tweetIds)) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, tweetIds' }, 400);
  }
  try {
    const actionsMap = await getActions(c.env.DB, xAccountId, tweetIds);
    return c.json({ success: true, data: actionsMap });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch actions' }, 500);
  }
});

// POST /api/posts/:id/reply — reply to a specific tweet
posts.post('/api/posts/:id/reply', async (c) => {
  const tweetId = c.req.param('id');
  const { xAccountId, text } = await c.req.json<{ xAccountId: string; text: string }>();
  if (!xAccountId || !text) return c.json({ success: false, error: 'Missing required fields: xAccountId, text' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    const tweet = await xClient.createTweet({ text, reply: { in_reply_to_tweet_id: tweetId } });
    c.executionCtx.waitUntil(recordAction(c.env.DB, { xAccountId, tweetId, actionType: 'reply' }));
    return c.json({ success: true, data: tweet }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to post reply' }, 500);
  }
});

// GET /api/x-accounts/:id/subscription — get account's X Premium subscription status
posts.get('/api/x-accounts/:id/subscription', async (c) => {
  const xAccountId = c.req.param('id');
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    const user = await xClient.getMeWithSubscription();
    const subscriptionType = user.subscription_type ?? 'None';
    const verifiedType = user.verified_type ?? 'none';
    // Character limits per subscription tier
    const charLimitMap: Record<string, number> = {
      None: 280,
      Basic: 10000,
      Premium: 10000,
      PremiumPlus: 25000,
    };
    const charLimit = charLimitMap[subscriptionType] ?? 280;
    return c.json({ success: true, data: { subscriptionType, verifiedType, charLimit } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch subscription info' }, 500);
  }
});

// POST /api/media/upload — proxy media file upload to X API
posts.post('/api/media/upload', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: 'Request must be multipart/form-data' }, 400);
  }

  const xAccountId = formData.get('xAccountId');
  const fileEntry = formData.get('file');

  if (!xAccountId || typeof xAccountId !== 'string') {
    return c.json({ success: false, error: 'Missing required field: xAccountId' }, 400);
  }
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ success: false, error: 'Missing required field: file (must be a file)' }, 400);
  }
  const file = fileEntry as File;

  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);

  const xClient = buildXClient(account);
  try {
    const mediaData = await file.arrayBuffer();
    const mediaCategory = (formData.get('mediaCategory') as string | null) ?? 'tweet_image';
    const mediaId = await xClient.uploadMedia(mediaData, file.type, mediaCategory);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'upload_media'));
    return c.json({ success: true, data: { mediaId } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to upload media' }, 500);
  }
});

// POST /api/posts/:id/like — like a tweet
posts.post('/api/posts/:id/like', async (c) => {
  const tweetId = c.req.param('id');
  const { xAccountId } = await c.req.json<{ xAccountId: string }>();
  if (!xAccountId) return c.json({ success: false, error: 'Missing required field: xAccountId' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    await xClient.likeTweet(account.x_user_id, tweetId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'like_tweet'));
    c.executionCtx.waitUntil(recordAction(c.env.DB, { xAccountId, tweetId, actionType: 'like' }));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to like tweet' }, 500);
  }
});

// POST /api/posts/:id/retweet — retweet a tweet
posts.post('/api/posts/:id/retweet', async (c) => {
  const tweetId = c.req.param('id');
  const { xAccountId } = await c.req.json<{ xAccountId: string }>();
  if (!xAccountId) return c.json({ success: false, error: 'Missing required field: xAccountId' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);
  try {
    await xClient.retweet(account.x_user_id, tweetId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'retweet'));
    c.executionCtx.waitUntil(recordAction(c.env.DB, { xAccountId, tweetId, actionType: 'repost' }));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to retweet' }, 500);
  }
});

// GET /api/posts/:id/quotes — get quote tweets of a post (API + DB merged)
posts.get('/api/posts/:id/quotes', async (c) => {
  const tweetId = c.req.param('id');
  const xAccountId = c.req.query('xAccountId');
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] || null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);

  // Fetch from DB first
  const dbQuotes = await getQuoteTweetsBySource(c.env.DB, tweetId);
  const seenIds = new Set(dbQuotes.map((q) => q.id));

  let apiQuotes: Array<{
    id: string; text: string; authorId: string;
    authorUsername: string | null; authorDisplayName: string | null;
    authorProfileImageUrl: string | null; createdAt: string | null;
    publicMetrics: Record<string, number> | null;
  }> = [];

  try {
    const raw = await xClient.getQuoteTweets(tweetId) as {
      data: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at?: string;
        public_metrics?: { retweet_count: number; reply_count: number; like_count: number; quote_count: number; impression_count: number };
      }>;
      includes?: {
        users?: Array<{
          id: string;
          username: string;
          name: string;
          profile_image_url?: string;
        }>;
      };
      meta?: { next_token?: string };
    };
    const usersMap = new Map<string, { username: string; name: string; profile_image_url?: string }>();
    for (const u of raw.includes?.users ?? []) {
      usersMap.set(u.id, { username: u.username, name: u.name, profile_image_url: u.profile_image_url });
    }
    apiQuotes = (raw.data ?? []).map((t) => {
      const author = usersMap.get(t.author_id);
      return {
        id: t.id,
        text: t.text,
        authorId: t.author_id,
        authorUsername: author?.username ?? null,
        authorDisplayName: author?.name ?? null,
        authorProfileImageUrl: author?.profile_image_url ?? null,
        createdAt: t.created_at ?? null,
        publicMetrics: t.public_metrics ?? null,
      };
    });

    // Save to DB in background
    const toSave: SaveQuoteTweetInput[] = apiQuotes
      .filter((q) => q.createdAt)
      .map((q) => ({
        id: q.id,
        authorId: q.authorId,
        authorUsername: q.authorUsername,
        authorDisplayName: q.authorDisplayName,
        authorProfileImageUrl: q.authorProfileImageUrl,
        text: q.text,
        createdAt: q.createdAt!,
      }));
    if (toSave.length > 0) {
      c.executionCtx.waitUntil(saveQuoteTweets(c.env.DB, account.id, tweetId, toSave));
    }
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'get_quote_tweets'));
  } catch {
    // API failed — fall back to DB-only results
  }

  // Merge: API results take priority, then add DB-only items
  const merged = [...apiQuotes];
  for (const dbq of dbQuotes) {
    if (!merged.some((q) => q.id === dbq.id)) {
      merged.push({
        id: dbq.id,
        text: dbq.text,
        authorId: dbq.author_id,
        authorUsername: dbq.author_username,
        authorDisplayName: dbq.author_display_name,
        authorProfileImageUrl: dbq.author_profile_image_url,
        createdAt: dbq.created_at,
        publicMetrics: null,
      });
    }
  }

  const data = merged.map((q) => ({
    ...q,
    inReplyToTweetId: tweetId,
    parentTweetText: null,
    parentTweetAuthor: null,
  }));

  return c.json({ success: true, data });
});

// GET /api/quotes — all saved quote tweets for an account from DB
posts.get('/api/quotes', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  if (!xAccountId) return c.json({ success: false, error: 'Missing xAccountId' }, 400);
  const limit = Number(c.req.query('limit') || '50');
  const offset = Number(c.req.query('offset') || '0');
  const dbQuotes = await getQuoteTweetsByAccount(c.env.DB, xAccountId, limit, offset);
  const lastSync = await getLatestDiscoveredAt(c.env.DB, xAccountId);
  const data = dbQuotes.map((q) => ({
    id: q.id,
    text: q.text,
    sourceTweetId: q.source_tweet_id,
    authorId: q.author_id,
    authorUsername: q.author_username,
    authorDisplayName: q.author_display_name,
    authorProfileImageUrl: q.author_profile_image_url,
    createdAt: q.created_at,
    discoveredAt: q.discovered_at,
    publicMetrics: null,
  }));
  return c.json({ success: true, data, lastSync });
});

// POST /api/quotes/sync — trigger a sync of quote tweets for an account
posts.post('/api/quotes/sync', async (c) => {
  const { xAccountId } = await c.req.json<{ xAccountId: string }>();
  if (!xAccountId) return c.json({ success: false, error: 'Missing xAccountId' }, 400);
  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);

  try {
    // Get recent tweets
    const tweetsRes = await xClient.getUserTweets(account.x_user_id, 100);
    const tweets = tweetsRes.data ?? [];
    let totalSaved = 0;

    // Fetch quotes for each tweet
    for (const tweet of tweets) {
      try {
        const raw = await xClient.getQuoteTweets(tweet.id) as {
          data: Array<{ id: string; text: string; author_id: string; created_at?: string }>;
          includes?: { users?: Array<{ id: string; username: string; name: string; profile_image_url?: string }> };
        };
        const usersMap = new Map<string, { username: string; name: string; profile_image_url?: string }>();
        for (const u of raw.includes?.users ?? []) {
          usersMap.set(u.id, { username: u.username, name: u.name, profile_image_url: u.profile_image_url });
        }
        const toSave: SaveQuoteTweetInput[] = (raw.data ?? [])
          .filter((t) => t.created_at)
          .map((t) => {
            const author = usersMap.get(t.author_id);
            return {
              id: t.id,
              authorId: t.author_id,
              authorUsername: author?.username ?? null,
              authorDisplayName: author?.name ?? null,
              authorProfileImageUrl: author?.profile_image_url ?? null,
              text: t.text,
              createdAt: t.created_at!,
            };
          });
        if (toSave.length > 0) {
          await saveQuoteTweets(c.env.DB, account.id, tweet.id, toSave);
          totalSaved += toSave.length;
        }
      } catch {
        // Skip individual tweet errors
      }
    }

    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'sync_quotes'));
    return c.json({ success: true, data: { tweetsChecked: tweets.length, quotesSaved: totalSaved } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to sync quotes' }, 500);
  }
});

export { posts };
