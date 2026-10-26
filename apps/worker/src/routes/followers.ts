import { publicRateLimit, takeQuota } from '../services/rate-limit.js';
import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import { getFollowers, getFollowerById, getFollowerCount, addTagToFollower, removeTagFromFollower, getFollowerTags, getTagById, getXAccounts, incrementApiUsage, getEndpointUsageForDate } from '@x-harness/db';
import type { Env } from '../index.js';

interface FollowerSearchResult {
  id: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
}

const followers = new Hono<Env>();

function serialize(row: any) {
  return {
    id: row.id,
    xAccountId: row.x_account_id,
    xUserId: row.x_user_id,
    username: row.username,
    displayName: row.display_name,
    profileImageUrl: row.profile_image_url,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    isFollowing: !!row.is_following,
    isFollowed: !!row.is_followed,
    userId: row.user_id,
    metadata: JSON.parse(row.metadata || '{}'),
    firstSeenAt: row.first_seen_at,
    unfollowedAt: row.unfollowed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Local followers-table search, shared by /api/followers/search and the
// daily-cap fallback of /api/users/search.
async function searchLocalFollowers(db: D1Database, q: string, limit: number, accountId?: string): Promise<FollowerSearchResult[]> {
  const pattern = `%${q}%`;
  const result = await db.prepare(
    `SELECT x_user_id, username, display_name, profile_image_url
     FROM followers
     WHERE (? IS NULL OR x_account_id=?) AND (username LIKE ? OR display_name LIKE ?)
     ORDER BY
       CASE WHEN username LIKE ? THEN 0 ELSE 1 END,
       username ASC
     LIMIT ?`,
  )
    .bind(accountId ?? null, accountId ?? null, pattern, pattern, `${q}%`, limit)
    .all<{ x_user_id: string; username: string; display_name: string; profile_image_url: string | null }>();

  return (result.results ?? []).map((r) => ({
    id: r.x_user_id,
    username: r.username,
    displayName: r.display_name,
    profileImageUrl: r.profile_image_url,
  }));
}

// This endpoint is public (LIFF browsers call it without auth), so each
// request spends real X API money. Cap it per day and degrade to the local
// followers table when the cap is hit.
const USER_SEARCH_DEFAULT_DAILY_LIMIT = 50;

// Public live user search endpoint — calls X API directly (called from LIFF browser)
followers.get('/api/users/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if(q.length>50) return c.json({success:false,error:'Query too long'},400);
  const limit = Math.min(20,Math.max(1,Math.floor(Number(c.req.query('limit')))||5));

  const gateId = c.req.query('gateId');
  const gate = gateId ? await c.env.DB.prepare('SELECT x_account_id, expires_at FROM engagement_gates WHERE id=? AND is_active=1').bind(gateId).first<{x_account_id:string;expires_at:string|null}>() : null;
  if (!c.get('staffRole') && (!gate || (gate.expires_at && Date.parse(gate.expires_at)<=Date.now()))) return c.json({success:false,error:'Active gate required'},404);
  if(!await publicRateLimit(c,'user-search',5,50)) return c.json({success:false,error:'Too many requests'},429);
  if(q.length<2) return c.json({success:true,data:[]});
  const cacheKey=`${gate?.x_account_id ?? 'admin'}:${q.toLowerCase()}:${limit}`;
  const cached = await c.env.DB.prepare('SELECT json FROM user_search_cache WHERE cache_key=? AND fetched_at>?').bind(cacheKey,Date.now()-86400000).first<{json:string}>();
  if(cached) return c.json({success:true,data:JSON.parse(cached.json),cached:true});
  try {
    // Absent/invalid env → default; explicit 0 disables paid search entirely.
    const envLimit = c.env.USER_SEARCH_DAILY_LIMIT;
    const parsedLimit = envLimit === undefined || envLimit === '' ? NaN : Number(envLimit);
    const dailyLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : USER_SEARCH_DEFAULT_DAILY_LIMIT;

    if (dailyLimit === 0) {
      const data = await searchLocalFollowers(c.env.DB, q, limit, gate?.x_account_id);
      return c.json({ success: true, data, capped: true });
    }

    const { XClient } = await import('@x-harness/x-sdk');
    const accounts = await getXAccounts(c.env.DB);
    const account = (gate ? accounts.find(a=>a.id===gate.x_account_id) : accounts[0]) ?? null;
    if (!account) {
      return c.json({ success: true, data: [] as FollowerSearchResult[] });
    }

    // Reserve quota atomically BEFORE spending: increment first, then read
    // back. Concurrent bursts each reserve their own slot, so the read-back
    // reflects at least this request's reservation and the cap cannot be
    // raced past. The quota counter (user_search_quota) is non-billable and
    // excluded from usage reports; actual spend is recorded separately below.
    await incrementApiUsage(c.env.DB, account.id, 'user_search_quota');
    const usedToday = await getEndpointUsageForDate(c.env.DB, 'user_search_quota');
    if (usedToday > dailyLimit) {
      console.warn(`[user-search] daily cap reached (${usedToday}/${dailyLimit}), falling back to local search`);
      const data = await searchLocalFollowers(c.env.DB, q, limit, gate?.x_account_id);
      return c.json({ success: true, data, capped: true });
    }

    const xClient = await buildXClient(c.env, account, 'followers');

    // Request telemetry is separate from the response resource spend ledger.
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'user_search'));
    const result = await xClient.searchUsers(q, limit);
    const users = (result.data ?? []).slice(0, limit);

    const data: FollowerSearchResult[] = users.map((u: any) => ({
      id: u.id,
      username: u.username,
      displayName: u.name,
      profileImageUrl: u.profile_image_url ?? null,
    }));

    await c.env.DB.prepare('INSERT INTO user_search_cache(cache_key,json,fetched_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at').bind(cacheKey,JSON.stringify(data),Date.now()).run();
    return c.json({ success: true, data });
  } catch {
    console.error('[user-search] upstream unavailable; returning cached local matches');
    return c.json({ success: true, data: await searchLocalFollowers(c.env.DB,q,limit,gate?.x_account_id), fallback:true });
  }
});

// CRM search requires authentication; public LIFF uses gate-scoped /api/users/search.
followers.get('/api/followers/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if(q.length>50) return c.json({success:false,error:'Query too long'},400);
  const limit = Math.min(20,Math.max(1,Math.floor(Number(c.req.query('limit')))||5));

  if (!q) {
    return c.json({ success: true, data: [] as FollowerSearchResult[] });
  }

  const data = await searchLocalFollowers(c.env.DB, q, limit, c.req.query('xAccountId'));
  return c.json({ success: true, data });
});

followers.get('/api/followers', async (c) => {
  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');
  const tagId = c.req.query('tagId');
  const xAccountId = c.req.query('xAccountId');
  const [items, total] = await Promise.all([
    getFollowers(c.env.DB, { limit, offset, tagId: tagId ?? undefined, xAccountId: xAccountId ?? undefined }),
    getFollowerCount(c.env.DB, { tagId: tagId ?? undefined, xAccountId: xAccountId ?? undefined }),
  ]);
  return c.json({
    success: true,
    data: {
      items: items.map(serialize),
      total,
      page: Math.floor(offset / limit),
      limit,
      hasNextPage: offset + limit < total,
    },
  });
});

followers.get('/api/followers/:id', async (c) => {
  const follower = await getFollowerById(c.env.DB, c.req.param('id'));
  if (!follower) return c.json({ success: false, error: 'Not found' }, 404);
  const rawTags = await getFollowerTags(c.env.DB, follower.id);
  // Enrich tags with x_account_id and created_at for a full Tag object
  const tags = await Promise.all(
    rawTags.map(async (t) => {
      const full = await getTagById(c.env.DB, t.id);
      return full
        ? { id: full.id, xAccountId: full.x_account_id, name: full.name, color: full.color, createdAt: full.created_at }
        : { id: t.id, xAccountId: null, name: t.name, color: t.color, createdAt: null };
    }),
  );
  return c.json({ success: true, data: { ...serialize(follower), tags } });
});

followers.post('/api/followers/:id/tags', async (c) => {
  const { tagId } = await c.req.json<{ tagId: string }>();
  if (!tagId) return c.json({ success: false, error: 'Missing required field: tagId' }, 400);
  // Verify the follower and tag belong to the same X account to prevent cross-account tag assignment
  const [follower, tag] = await Promise.all([
    getFollowerById(c.env.DB, c.req.param('id')),
    getTagById(c.env.DB, tagId),
  ]);
  if (!follower) return c.json({ success: false, error: 'Follower not found' }, 404);
  if (!tag) return c.json({ success: false, error: 'Tag not found' }, 404);
  if (follower.x_account_id !== tag.x_account_id) {
    return c.json({ success: false, error: 'Tag and follower must belong to the same X account' }, 400);
  }
  await addTagToFollower(c.env.DB, c.req.param('id'), tagId);
  return c.json({ success: true });
});

followers.delete('/api/followers/:id/tags/:tagId', async (c) => {
  await removeTagFromFollower(c.env.DB, c.req.param('id'), c.req.param('tagId'));
  return c.json({ success: true });
});

export { followers };
