import { syncFollowers } from '../services/follower-sync.js';
import { encryptSecret } from '@x-harness/db';
import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import { createXAccount, getXAccounts, getXAccountById, updateXAccount, getEngagementGates, getSnapshots, hasSnapshotForToday, recordSnapshot } from '@x-harness/db';
import { XClient } from '@x-harness/x-sdk';
import type { Env } from '../index.js';

const xAccounts = new Hono<Env>();

function serialize(a: any) {
  return {
    id: a.id,
    xUserId: a.x_user_id,
    username: a.username,
    displayName: a.display_name,
    isActive: !!a.is_active,
    needsReauth: !!a.needs_reauth,
    tokenExpiresAt: a.token_expires_at,
    createdAt: a.created_at,
  };
}

xAccounts.post('/api/x-accounts', async (c) => {
  const body = await c.req.json<{
    xUserId: string;
    username: string;
    accessToken: string;
    refreshToken?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    tokenExpiresAt?: number;
    displayName?: string;
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
  }>();
  if (!body.xUserId || !body.username || !body.accessToken) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }
  for(const field of ['accessToken','refreshToken','consumerSecret','accessTokenSecret'] as const) if(body[field]) body[field]=await encryptSecret(body[field]!,c.env.ENCRYPTION_KEY);
  const account = await createXAccount(c.env.DB, body);
  if(body.oauthClientId) await c.env.DB.prepare('UPDATE x_accounts SET oauth_client_id=?,oauth_client_secret=?,token_expires_at=? WHERE id=?').bind(body.oauthClientId,body.oauthClientSecret?await encryptSecret(body.oauthClientSecret,c.env.ENCRYPTION_KEY):null,body.tokenExpiresAt ?? null,account.id).run();
  return c.json({ success: true, data: serialize(account) }, 201);
});

xAccounts.get('/api/x-accounts', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM x_accounts ORDER BY created_at').all<any>();

  const activeGates = await getEngagementGates(c.env.DB, { activeOnly: true });
  const totalApiCalls = activeGates.reduce((sum, g) => sum + (g.api_calls_total ?? 0), 0);

  return c.json({
    success: true,
    data: result.results.map(serialize),
    polling: {
      activeGates: activeGates.length,
      totalApiCalls,
      estimatedTotalCost: '支出台帳を参照',
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
    oauthClientId?: string;
    oauthClientSecret?: string;
    tokenExpiresAt?: number;
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
    isActive?: boolean;
  }>();
  const existing = await getXAccountById(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
  for(const field of ['accessToken','refreshToken','consumerSecret','accessTokenSecret'] as const) if(body[field]) body[field]=await encryptSecret(body[field]!,c.env.ENCRYPTION_KEY);
  await updateXAccount(c.env.DB, c.req.param('id'), body);
  if(body.oauthClientId) await c.env.DB.prepare('UPDATE x_accounts SET oauth_client_id=?,oauth_client_secret=?,token_expires_at=?,needs_reauth=0 WHERE id=?').bind(body.oauthClientId,body.oauthClientSecret?await encryptSecret(body.oauthClientSecret,c.env.ENCRYPTION_KEY):null,body.tokenExpiresAt ?? null,c.req.param('id')).run();
  return c.json({ success: true });
});

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

  const xClient = await buildXClient(c.env, account, 'x-accounts');

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

xAccounts.post('/api/x-accounts/:id/followers/sync',async c=>{
 const account=await getXAccountById(c.env.DB,c.req.param('id'));if(!account)return c.json({success:false,error:'Not found'},404);
 const full=c.req.query('full')==='1';const body=await c.req.json<{confirmFull?:boolean}>();
 if(full&&!body.confirmFull)return c.json({success:false,error:'Explicit full-sync cost confirmation required'},400);
 const client=await buildXClient(c.env,account,'follower-sync');await syncFollowers(c.env.DB,client,account.id,{full});
 return c.json({success:true,data:{mode:full?'full':'recent-engagers'}});
});
export { xAccounts };
