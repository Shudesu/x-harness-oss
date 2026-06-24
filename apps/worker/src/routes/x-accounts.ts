import { Hono } from 'hono';
//0618修正開始
import { createXAccount, getXAccounts, getXAccountById, updateXAccount, updateXAccountProfile, getEngagementGates, getSnapshots, hasSnapshotForToday, recordSnapshot } from '@x-harness/db';
//0618修正終了
import { XClient } from '@x-harness/x-sdk';
import type { Env } from '../index.js';

const xAccounts = new Hono<Env>();

function serialize(a: any) {
  return {
    id: a.id,
    xUserId: a.x_user_id,
    username: a.username,
    displayName: a.display_name,
    // 0618追加開始
    profileImageUrl: a.profile_image_url,
    // 0618追加終了
    isActive: !!a.is_active,
    createdAt: a.created_at,
  };
}

xAccounts.post('/api/x-accounts', async (c) => {
  const body = await c.req.json<{
    xUserId: string;
    username: string;
    accessToken: string;
    refreshToken?: string;
    displayName?: string;
    // 0618追加開始
    profileImageUrl?: string;
    // 0618追加終了
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
  }>();
  if (!body.xUserId || !body.username || !body.accessToken) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }
  //202606修正開始
  /*
  const account = await createXAccount(c.env.DB, body);
  return c.json({ success: true, data: serialize(account) }, 201);
  */
  let accountInput = body;

if (body.consumerKey && body.consumerSecret && body.accessTokenSecret) {
  const xClient = new XClient({
    type: 'oauth1',
    consumerKey: body.consumerKey,
    consumerSecret: body.consumerSecret,
    accessToken: body.accessToken,
    accessTokenSecret: body.accessTokenSecret,
  });

  const me = await xClient.getMe();

  accountInput = {
    ...body,
    xUserId: me.id,
    username: me.username,
    displayName: me.name,
    profileImageUrl: me.profile_image_url,
  };
}

const account = await createXAccount(c.env.DB, accountInput);
return c.json({ success: true, data: serialize(account) }, 201);
  //202606修正終了
});

xAccounts.get('/api/x-accounts', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM x_accounts ORDER BY created_at').all<any>();

  const activeGates = await getEngagementGates(c.env.DB, { activeOnly: true });

// ======================================
// 202606 API使用量集計修正開始
// polling.totalApiCalls は既存 engagement_gates.api_calls_total と
// api_usage_logs の engagement_gate_poll 記録の大きい方を使う
// 既存データを壊さないため、古い値もfallbackとして残す
// ======================================
const pollingTotal = await c.env.DB
  .prepare(`
    SELECT COALESCE(SUM(api_calls_total), 0) AS total
    FROM engagement_gates
  `)
  .first<{ total: number }>();

const usagePollingTotal = await c.env.DB
  .prepare(`
    SELECT COALESCE(SUM(request_count), 0) AS total
    FROM api_usage_logs
    WHERE endpoint = 'engagement_gate_poll'
       OR endpoint LIKE 'engagement_gate_poll:%'
  `)
  .first<{ total: number }>();

const totalApiCalls = Math.max(
  Number(pollingTotal?.total ?? 0),
  Number(usagePollingTotal?.total ?? 0),
);
  //const totalApiCalls = activeGates.reduce((sum, g) => sum + (g.api_calls_total ?? 0), 0);
// ======================================
// 202606 API使用量集計修正終了
// ======================================
  
  return c.json({
    success: true,
    data: result.results.map(serialize),
    polling: {
      activeGates: activeGates.length,
      totalApiCalls,
      estimatedTotalCost: `$${(totalApiCalls * 0.005).toFixed(2)}`,
      gates: activeGates.map((g) => ({
        id: g.id,
        postId: g.post_id,
        strategy: g.polling_strategy ?? 'hot_window',
        nextPollAt: g.next_poll_at,
        expiresAt: g.expires_at,
        apiCallsTotal: g.api_calls_total ?? 0,
      })),
    },
  });
});

xAccounts.put('/api/x-accounts/:id', async (c) => {
  const body = await c.req.json<{
    accessToken?: string;
    refreshToken?: string;
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
    isActive?: boolean;
  }>();
  
  const existing = await getXAccountById(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
  await updateXAccount(c.env.DB, c.req.param('id'), body);
  return c.json({ success: true });
});
// 0618追加開始
xAccounts.post('/api/x-accounts/:id/refresh-profile', async (c) => {
  const id = c.req.param('id');

  const account = await getXAccountById(c.env.DB, id);
  if (!account) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  if (!account.consumer_key || !account.consumer_secret || !account.access_token_secret) {
    return c.json(
      {
        success: false,
        error: 'プロフィール更新には OAuth1 情報が必要です',
      },
      400,
    );
  }

  const xClient = new XClient({
    type: 'oauth1',
    consumerKey: account.consumer_key,
    consumerSecret: account.consumer_secret,
    accessToken: account.access_token,
    accessTokenSecret: account.access_token_secret,
  });

  const me = await xClient.getMe();

  await updateXAccountProfile(c.env.DB, id, {
    username: me.username,
    displayName: me.name,
    profileImageUrl: me.profile_image_url,
  });

  const updated = await getXAccountById(c.env.DB, id);

  return c.json({
    success: true,
    data: updated ? serialize(updated) : null,
  });
});
// 0618追加終了
xAccounts.get('/api/x-accounts/:id/stats', async (c) => {
  const id = c.req.param('id');
  const existing = await getXAccountById(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

  const snapshots = await getSnapshots(c.env.DB, id, 30);
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // Find snapshots closest to 7 and 30 days ago
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const snap7 = snapshots.find((s) => s.recorded_at <= d7) ?? snapshots[0] ?? null;
  const snap30 = snapshots[0] ?? null;

  return c.json({
    success: true,
    data: {
      current: latest
        ? {
            followersCount: latest.followers_count,
            followingCount: latest.following_count,
            tweetCount: latest.tweet_count,
            recordedAt: latest.recorded_at,
          }
        : null,
      history: snapshots.map((s) => ({
        followersCount: s.followers_count,
        followingCount: s.following_count,
        tweetCount: s.tweet_count,
        recordedAt: s.recorded_at,
      })),
      growth: {
        days7: latest && snap7 ? latest.followers_count - snap7.followers_count : null,
        days30: latest && snap30 ? latest.followers_count - snap30.followers_count : null,
      },
    },
  });
});

// POST /api/x-accounts/:id/snapshot — manually record a follower snapshot
xAccounts.post('/api/x-accounts/:id/snapshot', async (c) => {
  const id = c.req.param('id');
  const account = await getXAccountById(c.env.DB, id);
  if (!account) return c.json({ success: false, error: 'Not found' }, 404);

  const already = await hasSnapshotForToday(c.env.DB, id);
  if (already) return c.json({ success: true, message: 'Already recorded today' });

  const xClient = account.consumer_key && account.consumer_secret && account.access_token_secret
    ? new XClient({
        type: 'oauth1',
        consumerKey: account.consumer_key,
        consumerSecret: account.consumer_secret,
        accessToken: account.access_token,
        accessTokenSecret: account.access_token_secret,
      })
    : new XClient(account.access_token);

  const me = await xClient.getMe();
  if (!me.public_metrics) return c.json({ success: false, error: 'No public_metrics' }, 500);

  await recordSnapshot(c.env.DB, {
    xAccountId: id,
    followersCount: me.public_metrics.followers_count,
    followingCount: me.public_metrics.following_count,
    tweetCount: me.public_metrics.tweet_count,
  });

  return c.json({ success: true, data: me.public_metrics });
});

export { xAccounts };
