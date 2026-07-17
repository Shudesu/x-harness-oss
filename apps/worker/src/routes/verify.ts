import { Hono } from 'hono';
import { getEngagementGateById, getDeliveredUserIds, getXAccounts, createDelivery, incrementApiUsage, incrementApiUsageBy, getEndpointUsageForDate } from '@x-harness/db';
import type { Env } from '../index.js';
import { EngagementCache, checkConditions } from '../services/reply-trigger-cache.js';
import { XClient, XApiError, XApiRateLimitError } from '@x-harness/x-sdk';

const verify = new Hono<Env>();

// ─── Cache helpers ───

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Owned Reads bill per returned follower ($0.001/item), so follower crawls are
// the most expensive thing this worker can do. Verification only needs the
// newest page — the verifying user followed moments ago.
const FOLLOW_CRAWL_MAX_PAGES = 1;

interface CachedEngager {
  username: string;
  xUserId: string;
  displayName: string;
  profileImageUrl: string | null;
  eligible: boolean;
  conditions: { repost: boolean | null; like: boolean | null; follow: boolean | null; reply: boolean | null };
}

async function getCachedEngagers(db: D1Database, gateId: string): Promise<CachedEngager[] | null> {
  const rows = await db
    .prepare('SELECT x_user_id, username, display_name, profile_image_url, eligible, conditions_json, cached_at FROM replier_cache WHERE gate_id = ? ORDER BY username')
    .bind(gateId)
    .all<{ x_user_id: string; username: string; display_name: string; profile_image_url: string | null; eligible: number; conditions_json: string | null; cached_at: string }>();

  if (rows.results.length === 0) return null;

  // Cache never expires — it accumulates over time since getRetweetedBy
  // only returns ~100 per call. When a user is not in cache, the verify
  // endpoint triggers a refresh that adds new entries via UPSERT.

  return rows.results.map((r) => ({
    xUserId: r.x_user_id,
    username: r.username,
    displayName: r.display_name,
    profileImageUrl: r.profile_image_url,
    eligible: r.eligible === 1,
    conditions: r.conditions_json ? JSON.parse(r.conditions_json) : { repost: null, like: null, follow: null, reply: null },
  }));
}

// Single-row lookup for verify paths — a warmed follow gate can hold 10k+
// cached rows, so verify must not load the whole gate cache per request.
async function getCachedEngager(db: D1Database, gateId: string, username: string): Promise<{ engager: CachedEngager; cachedAt: string } | null> {
  const r = await db
    .prepare('SELECT x_user_id, username, display_name, profile_image_url, eligible, conditions_json, cached_at FROM replier_cache WHERE gate_id = ? AND username = ? COLLATE NOCASE')
    .bind(gateId, username)
    .first<{ x_user_id: string; username: string; display_name: string; profile_image_url: string | null; eligible: number; conditions_json: string | null; cached_at: string }>();
  if (!r) return null;
  return {
    engager: {
      xUserId: r.x_user_id,
      username: r.username,
      displayName: r.display_name,
      profileImageUrl: r.profile_image_url,
      eligible: r.eligible === 1,
      conditions: r.conditions_json ? JSON.parse(r.conditions_json) : { repost: null, like: null, follow: null, reply: null },
    },
    cachedAt: r.cached_at,
  };
}

// Cheap emptiness probe — distinguishes "gate never warmed" from "user not
// in cache" without loading every row.
async function hasCachedEngagers(db: D1Database, gateId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM replier_cache WHERE gate_id = ? LIMIT 1').bind(gateId).first();
  return !!row;
}

async function setCachedEngagers(db: D1Database, gateId: string, engagers: CachedEngager[]): Promise<void> {
  if (engagers.length === 0) return;

  // UPSERT: add new engagers, update existing ones. Never delete —
  // getRetweetedBy only returns ~100 users per call, but returns a
  // slightly different set each time. By accumulating, the cache
  // eventually covers all retweeters.
  const now = new Date().toISOString();
  const statements = engagers.map((r) =>
    db
      .prepare(`INSERT INTO replier_cache (gate_id, x_user_id, username, display_name, profile_image_url, eligible, conditions_json, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (gate_id, x_user_id) DO UPDATE SET
          username = excluded.username,
          display_name = excluded.display_name,
          profile_image_url = excluded.profile_image_url,
          eligible = excluded.eligible,
          conditions_json = excluded.conditions_json,
          cached_at = excluded.cached_at`)
      .bind(gateId, r.xUserId, r.username, r.displayName, r.profileImageUrl, r.eligible ? 1 : 0, JSON.stringify(r.conditions), now),
  );
  // Batched writes — a follow crawl can produce up to 10k rows, and one
  // serial .run() per row would time out the request. D1 batch caps at 100.
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }
}

// ─── X API usage metering ───
// Counts billable X API requests in memory, then flushes them to
// api_usage_logs in one batched write per endpoint. Flush failures are
// logged, never thrown — metering must not break verify.
function createUsageMeter() {
  const counts = new Map<string, number>();
  return {
    track(endpoint: string): void {
      counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
    },
    async flush(db: D1Database, xAccountId: string): Promise<void> {
      for (const [endpoint, count] of counts) {
        try {
          await incrementApiUsageBy(db, xAccountId, endpoint, count);
        } catch (err) {
          console.error('[usage] flush failed:', endpoint, err);
        }
      }
      counts.clear();
    },
  };
}

// ─── Refresh markers ───
// Gate-wide / account-wide "last refreshed" timestamps, stored in the
// settings KV table. Kept separate from replier_cache.cached_at because
// per-user re-checks bump row timestamps and must not make the whole gate
// look freshly refreshed.
async function getMarker(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setMarker(db: D1Database, key: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, now, now)
    .run();
}

function markerAgeMs(marker: string | null): number {
  return marker ? Date.now() - new Date(marker).getTime() : Infinity;
}

async function clearMarker(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
}

// Atomically claim a marker: succeeds only if the marker is absent or older
// than maxAgeMs. The conditional UPSERT makes concurrent claimers race-safe —
// exactly one wins per window, so expensive crawls can't run in parallel.
async function claimMarker(db: D1Database, key: string, maxAgeMs: number): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const res = await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE settings.value < ?`,
    )
    .bind(key, now.toISOString(), now.toISOString(), cutoff)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// In-flight lock: prevents multiple concurrent cache refreshes for the same gate.
const inflight = new Map<string, Promise<CachedEngager[]>>();

async function fetchAndCacheDeduped(
  db: D1Database, xClient: XClient,
  gate: NonNullable<Awaited<ReturnType<typeof getEngagementGateById>>>,
  accountXUserId: string,
): Promise<CachedEngager[]> {
  const existing = inflight.get(gate.id);
  if (existing) return existing;

  const promise = fetchAndCache(db, xClient, gate, accountXUserId)
    .finally(() => inflight.delete(gate.id));
  inflight.set(gate.id, promise);
  return promise;
}

async function fetchAndCache(
  db: D1Database, xClient: XClient,
  gate: NonNullable<Awaited<ReturnType<typeof getEngagementGateById>>>,
  accountXUserId: string,
): Promise<CachedEngager[]> {
  const meter = createUsageMeter();
  try {
    const result = await fetchAndCacheMetered(db, xClient, gate, accountXUserId, meter);
    await setMarker(db, `gate_cache_refresh:${gate.id}`);
    return result;
  } finally {
    await meter.flush(db, gate.x_account_id);
  }
}

async function fetchAndCacheMetered(
  db: D1Database, xClient: XClient,
  gate: NonNullable<Awaited<ReturnType<typeof getEngagementGateById>>>,
  accountXUserId: string,
  meter: ReturnType<typeof createUsageMeter>,
): Promise<CachedEngager[]> {
  const deliveredIds = await getDeliveredUserIds(db, gate.id);
  const cache = new EngagementCache(meter.track);
  const engagers: CachedEngager[] = [];

  if (gate.trigger_type === 'repost') {
    // ─── Repost trigger: getRetweetedBy (no spam filter) ───
    meter.track('verify_get_retweeted_by');
    const result = await xClient.getRetweetedBy(gate.post_id);
    if (!result.data || result.data.length === 0) {
      await setCachedEngagers(db, gate.id, []);
      return [];
    }

    for (const user of result.data) {
      if (deliveredIds.has(user.id)) {
        engagers.push({
          xUserId: user.id, username: user.username, displayName: user.name,
          profileImageUrl: user.profile_image_url || null, eligible: true,
          conditions: { repost: true, like: true, follow: true, reply: null },
        });
        continue;
      }

      const conditions = await checkConditions(xClient, cache, gate, user.id, accountXUserId);
      const eligible = (!gate.require_like || conditions.like)
        && (!gate.require_follow || conditions.follow);

      engagers.push({
        xUserId: user.id, username: user.username, displayName: user.name,
        profileImageUrl: user.profile_image_url || null, eligible,
        conditions: {
          repost: true,
          like: gate.require_like ? conditions.like : null,
          follow: gate.require_follow ? conditions.follow : null,
          reply: null,
        },
      });
    }
  } else if (gate.trigger_type === 'follow') {
    // ─── Follow trigger: getFollowers (newest page only) ───
    // Owned Reads are billed PER RETURNED FOLLOWER, so a full crawl of a 10k
    // account costs ~$10 every cache miss. The verifying user just followed,
    // so they are always near the head of page 1 — one page is enough.
    // No checkConditions needed — follow itself is the trigger.
    // Cheapest option: just getFollowers, no per-user condition checks.
    // This path is reachable from the public /repliers endpoint, so claim
    // the same crawl slot the verify path uses — concurrent cache-miss
    // requests must not each run a 10-page crawl.
    const claimed = await claimMarker(db, `follower_sync:${accountXUserId}`, 2 * 60 * 1000);
    if (!claimed) return [];
    const requiresExtra = !!(gate.require_like || gate.require_repost);
    try {
      let paginationToken: string | undefined;
      let page = 0;
      do {
        meter.track('verify_get_followers');
        const result = await xClient.getFollowers(accountXUserId, paginationToken);
        if (result.data) {
          for (const user of result.data) {
            if (!requiresExtra || deliveredIds.has(user.id)) {
              engagers.push({
                xUserId: user.id, username: user.username, displayName: user.name,
                profileImageUrl: user.profile_image_url || null,
                eligible: true,
                conditions: { follow: true, repost: null, like: null, reply: null },
              });
              continue;
            }
            // Follow gates can also require like/repost of gate.post_id —
            // don't cache followers as eligible without checking them.
            // The shared cache means the like/retweet lists are fetched once.
            const conds = await checkConditions(xClient, cache, { ...gate, require_follow: 0 }, user.id, accountXUserId);
            const ok = (!gate.require_like || conds.like) && (!gate.require_repost || conds.repost);
            engagers.push({
              xUserId: user.id, username: user.username, displayName: user.name,
              profileImageUrl: user.profile_image_url || null,
              eligible: ok,
              conditions: {
                follow: true,
                like: gate.require_like ? conds.like : null,
                repost: gate.require_repost ? conds.repost : null,
                reply: null,
              },
            });
          }
        }
        paginationToken = (result as any).meta?.next_token;
        page++;
      } while (paginationToken && page < FOLLOW_CRAWL_MAX_PAGES);
    } catch (err) {
      // Release the claim so the next request can retry immediately
      await clearMarker(db, `follower_sync:${accountXUserId}`);
      throw err;
    }
  } else if (gate.trigger_type === 'like') {
    // ─── Like trigger: getLikingUsers ───
    meter.track('verify_get_liking_users');
    const result = await xClient.getLikingUsers(gate.post_id);
    if (!result.data || result.data.length === 0) {
      await setCachedEngagers(db, gate.id, []);
      return [];
    }

    for (const user of result.data) {
      if (deliveredIds.has(user.id)) {
        engagers.push({
          xUserId: user.id, username: user.username, displayName: user.name,
          profileImageUrl: user.profile_image_url || null, eligible: true,
          conditions: { like: true, repost: true, follow: true, reply: null },
        });
        continue;
      }

      const conditions = await checkConditions(xClient, cache, gate, user.id, accountXUserId);
      const eligible = (!gate.require_repost || conditions.repost)
        && (!gate.require_follow || conditions.follow);

      engagers.push({
        xUserId: user.id, username: user.username, displayName: user.name,
        profileImageUrl: user.profile_image_url || null, eligible,
        conditions: {
          like: true,
          repost: gate.require_repost ? conditions.repost : null,
          follow: gate.require_follow ? conditions.follow : null,
          reply: null,
        },
      });
    }
  } else {
    // ─── Reply trigger: searchRecentTweets ───
    const keyword = gate.reply_keyword ? ` "${gate.reply_keyword}"` : '';
    meter.track('verify_search_replies');
    const result = await xClient.searchRecentTweets(
      `conversation_id:${gate.post_id} is:reply${keyword}`,
    );

    if (!result.data || result.data.length === 0) {
      await setCachedEngagers(db, gate.id, []);
      return [];
    }

    const includes = (result as any).includes as { users?: any[] } | undefined;
    const userMap = new Map<string, any>();
    if (includes?.users) {
      for (const u of includes.users) userMap.set(u.id, u);
    }

    const seen = new Set<string>();
    for (const tweet of result.data) {
      if (seen.has(tweet.author_id)) continue;
      seen.add(tweet.author_id);

      const u = userMap.get(tweet.author_id);
      if (!u) continue;

      if (deliveredIds.has(tweet.author_id)) {
        engagers.push({
          xUserId: u.id, username: u.username, displayName: u.name,
          profileImageUrl: u.profile_image_url || null, eligible: true,
          conditions: { reply: true, like: true, repost: true, follow: true },
        });
        continue;
      }

      const conditions = await checkConditions(xClient, cache, gate, tweet.author_id, accountXUserId);
      conditions.reply = true;
      const eligible = conditions.reply
        && (!gate.require_like || conditions.like)
        && (!gate.require_repost || conditions.repost)
        && (!gate.require_follow || conditions.follow);

      engagers.push({
        xUserId: u.id, username: u.username, displayName: u.name,
        profileImageUrl: u.profile_image_url || null, eligible,
        conditions: {
          reply: true,
          like: gate.require_like ? conditions.like : null,
          repost: gate.require_repost ? conditions.repost : null,
          follow: gate.require_follow ? conditions.follow : null,
        },
      });
    }
  }

  await setCachedEngagers(db, gate.id, engagers);
  return engagers;
}

// ─── Helper: build XClient from gate's account ───

async function buildXClientForGate(db: D1Database, gate: { x_account_id: string }) {
  const accounts = await getXAccounts(db);
  const account = accounts.find((a) => a.id === gate.x_account_id);
  if (!account) return null;

  const xClient = account.consumer_key && account.consumer_secret && account.access_token_secret
    ? new XClient({
        type: 'oauth1',
        consumerKey: account.consumer_key,
        consumerSecret: account.consumer_secret,
        accessToken: account.access_token,
        accessTokenSecret: account.access_token_secret,
      })
    : new XClient(account.access_token);

  return { xClient, account };
}

// ─── Trigger type label for user-facing messages ───

function triggerLabel(triggerType: string): string {
  switch (triggerType) {
    case 'repost': return 'リポスト';
    case 'like': return 'いいね';
    case 'follow': return 'フォロー';
    default: return 'リプライ';
  }
}

// ─── GET /verify — check if a user meets all conditions ───

verify.get('/api/engagement-gates/:id/verify', async (c) => {
  const gateId = c.req.param('id');
  const username = c.req.query('username')?.replace('@', '').trim();

  if (!username) {
    return c.json({ success: false, error: 'username query parameter required' }, 400);
  }

  const gate = await getEngagementGateById(c.env.DB, gateId);
  if (!gate) return c.json({ success: false, error: 'Gate not found' }, 404);
  if (!gate.is_active) return c.json({ success: false, error: 'This gate is no longer active' }, 400);
  if (gate.expires_at && new Date(gate.expires_at).getTime() <= Date.now()) {
    return c.json({ success: false, error: 'This gate has expired' }, 400);
  }

  const deliveredIds = await getDeliveredUserIds(c.env.DB, gateId);

  // ─── Follow trigger: check replier_cache first, then D1 follower cache, then X API ───
  if (gate.trigger_type === 'follow') {
    // 1. Check replier_cache (HAR imports + previously verified users) —
    // single-row lookup; a warmed follow gate can hold 10k+ rows
    const cachedHit = await getCachedEngager(c.env.DB, gateId, username);
    if (cachedHit) {
      const match = cachedHit.engager;
      if (match.eligible) {
        if (gate.action_type === 'verify_only' && !deliveredIds.has(match.xUserId)) {
          await createDelivery(c.env.DB, gateId, match.xUserId, match.username, null, 'delivered');
        }
        return c.json({
          success: true,
          data: { eligible: true, alreadyDelivered: deliveredIds.has(match.xUserId), conditions: match.conditions, cached: true },
        });
      }
      // Cached negative (non-follower, or follower who failed
      // require_like/repost) — throttle re-checks like the non-follow path
      if (markerAgeMs(cachedHit.cachedAt) < 2 * 60 * 1000) {
        return c.json({
          success: true,
          data: {
            eligible: false,
            alreadyDelivered: deliveredIds.has(match.xUserId),
            conditions: match.conditions,
            message: '条件を満たしていません。しばらく待ってから再度お試しください。',
            cached: true,
          },
        });
      }
    }

    // 2. Not in cache — resolve username and check follower_id_cache / X API
    const clientResult = await buildXClientForGate(c.env.DB, gate);
    if (!clientResult) return c.json({ success: false, error: 'X account not found' }, 500);

    // This endpoint is public and each unknown username costs a billable
    // lookup — cap it per day like /api/users/search (reserve, then check).
    // Absent/invalid env → default 500; explicit 0 disables paid lookups.
    const rawLookupLimit = c.env.VERIFY_LOOKUP_DAILY_LIMIT;
    const parsedLookupLimit = rawLookupLimit === undefined || rawLookupLimit === '' ? NaN : Number(rawLookupLimit);
    const lookupLimit = Number.isFinite(parsedLookupLimit) && parsedLookupLimit >= 0 ? parsedLookupLimit : 500;
    if (lookupLimit === 0) {
      return c.json({ success: false, error: '検証リクエストが多すぎます。しばらく後に再試行してください。' }, 429);
    }
    await incrementApiUsage(c.env.DB, gate.x_account_id, 'verify_lookup_quota');
    const lookupsToday = await getEndpointUsageForDate(c.env.DB, 'verify_lookup_quota');
    if (lookupsToday > lookupLimit) {
      console.warn(`[verify] daily lookup cap reached (${lookupsToday}/${lookupLimit})`);
      return c.json({ success: false, error: '検証リクエストが多すぎます。しばらく後に再試行してください。' }, 429);
    }

    let xUser;
    try {
      // Track before the call — a user-not-found response is still a billed request
      c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, gate.x_account_id, 'verify_get_user'));
      xUser = await clientResult.xClient.getUserByUsername(username);
    } catch (err) {
      // 404 = username doesn't exist; 400 = malformed username (e.g. >15
      // chars) — both mean "no such account". Everything else (rate limit,
      // 5xx, expired/revoked token) is an operational failure — don't tell
      // a valid follower their account doesn't exist.
      if (err instanceof XApiError && (err.status === 404 || err.status === 400)) {
        xUser = undefined;
      } else {
        return c.json({ success: false, error: 'X API エラー。しばらく後に再試行してください。' }, 503);
      }
    }
    if (!xUser) {
      return c.json({
        success: true,
        data: { eligible: false, conditions: { follow: false, repost: null, like: null, reply: null }, message: 'Xアカウントが見つかりません' },
      });
    }

    if (deliveredIds.has(xUser.id)) {
      return c.json({
        success: true,
        data: { eligible: true, alreadyDelivered: true, conditions: { follow: true, repost: null, like: null, reply: null } },
      });
    }

    // 3. Check D1 follower_id_cache
    const cachedFollower = await c.env.DB.prepare(
      'SELECT 1 FROM follower_id_cache WHERE x_account_id = ? AND follower_x_user_id = ?',
    ).bind(clientResult.account.x_user_id, xUser.id).first();

    let isFollower = !!cachedFollower;

    // 4. Cache miss — fetch from X API and cache ALL follower IDs.
    // Rate limit full crawls: only positive IDs are cached, so without this
    // guard every repeat submit by a non-follower would re-crawl up to 10
    // pages of getFollowers.
    if (!isFollower) {
      // NOTE: verify checks followers of the gate's own account — the actual
      // campaign pattern ("follow @account"). The cron poller instead treats
      // gate.post_id as the target user id (services/engagement-gate.ts);
      // dashboard-created follow gates store a tweet id there, so do NOT
      // switch this to post_id without unifying that convention first.
      const claimed = await claimMarker(c.env.DB, `follower_sync:${clientResult.account.x_user_id}`, 2 * 60 * 1000);
      if (!claimed) {
        return c.json({
          success: true,
          data: {
            eligible: false,
            conditions: { follow: false, repost: null, like: null, reply: null },
            message: 'フォローが確認できません。フォロー直後の場合は1〜2分待ってから再度お試しください。',
          },
        });
      }
      const meter = createUsageMeter();
      const engCache = new EngagementCache(meter.track);
      let followerIds: Set<string>;
      try {
        followerIds = await engCache.getFollowerIds(clientResult.xClient, clientResult.account.x_user_id);
      } catch (err) {
        // Release the claim so the next request can retry immediately
        // instead of being told "not a follower" for 2 minutes
        c.executionCtx.waitUntil(clearMarker(c.env.DB, `follower_sync:${clientResult.account.x_user_id}`));
        if (err instanceof XApiRateLimitError || (err instanceof XApiError && (err.status === 429 || err.status >= 500))) {
          return c.json({ success: false, error: 'X API エラー。しばらく後に再試行してください。' }, 503);
        }
        throw err;
      } finally {
        // Pages fetched before a failure are still billable — always flush
        c.executionCtx.waitUntil(meter.flush(c.env.DB, gate.x_account_id));
      }
      isFollower = followerIds.has(xUser.id);

      // Bulk cache follower IDs (fire-and-forget, don't block response)
      c.executionCtx.waitUntil((async () => {
        const now = new Date().toISOString();
        const batch: D1PreparedStatement[] = [];
        for (const fid of followerIds) {
          batch.push(
            c.env.DB.prepare('INSERT INTO follower_id_cache (x_account_id, follower_x_user_id, cached_at) VALUES (?, ?, ?) ON CONFLICT (x_account_id, follower_x_user_id) DO UPDATE SET cached_at = excluded.cached_at')
              .bind(clientResult.account.x_user_id, fid, now),
          );
        }
        // D1 batch supports up to 100 statements at a time
        for (let i = 0; i < batch.length; i += 100) {
          await c.env.DB.batch(batch.slice(i, i + 100));
        }
        // Sync marker was already claimed before the crawl — no update needed
      })());
    }

    // 5. Follow gates may additionally require like/repost of gate.post_id —
    // enforce them instead of delivering on follow alone
    const conditions: { follow: boolean; repost: boolean | null; like: boolean | null; reply: null } = {
      follow: isFollower, repost: null, like: null, reply: null,
    };
    let eligible = isFollower;
    if (isFollower && (gate.require_like || gate.require_repost)) {
      const condMeter = createUsageMeter();
      const condCache = new EngagementCache(condMeter.track);
      try {
        const extra = await checkConditions(
          clientResult.xClient, condCache, { ...gate, require_follow: 0 }, xUser.id, clientResult.account.x_user_id,
        );
        if (gate.require_like) conditions.like = extra.like;
        if (gate.require_repost) conditions.repost = extra.repost;
        eligible = (!gate.require_like || extra.like) && (!gate.require_repost || extra.repost);
      } catch (err) {
        if (err instanceof XApiRateLimitError || (err instanceof XApiError && (err.status === 429 || err.status >= 500))) {
          return c.json({ success: false, error: 'X API エラー。しばらく後に再試行してください。' }, 503);
        }
        throw err;
      } finally {
        c.executionCtx.waitUntil(condMeter.flush(c.env.DB, gate.x_account_id));
      }
    }

    // 6. Cache the result — negatives too (non-followers included), so
    // repeat submits are throttled by the cached-entry guard in step 1
    // instead of re-spending username lookups
    await setCachedEngagers(c.env.DB, gateId, [{
      xUserId: xUser.id, username: xUser.username, displayName: xUser.name,
      profileImageUrl: xUser.profile_image_url || null, eligible,
      conditions,
    }]);
    if (eligible && gate.action_type === 'verify_only' && !deliveredIds.has(xUser.id)) {
      await createDelivery(c.env.DB, gateId, xUser.id, username, null, 'delivered');
    }

    return c.json({
      success: true,
      data: {
        eligible,
        conditions,
        ...(eligible ? {} : { message: isFollower ? '条件を満たしていません' : 'フォローが確認できません' }),
      },
    });
  }

  // ─── Non-follow triggers: use cache ───
  // Emptiness probe + single-row lookup — never load the full gate cache here
  const gateWarmed = await hasCachedEngagers(c.env.DB, gateId);
  if (gateWarmed) {
    const hit = await getCachedEngager(c.env.DB, gateId, username);
    const match = hit?.engager;
    if (hit && match) {
      // Eligible → return immediately
      if (match.eligible) {
        if (gate.action_type === 'verify_only' && !deliveredIds.has(match.xUserId)) {
          await createDelivery(c.env.DB, gateId, match.xUserId, match.username, null, 'delivered');
        }
        return c.json({
          success: true,
          data: {
            eligible: true,
            alreadyDelivered: deliveredIds.has(match.xUserId),
            conditions: match.conditions,
            cached: true,
          },
        });
      }

      // Not eligible → re-check only the failed conditions (1-2 API calls max)
      // User might have followed/liked AFTER the cache was created.
      // Rate limit: only re-check if cache entry is older than 2 minutes
      const cacheAge = markerAgeMs(hit.cachedAt);
      if (cacheAge < 2 * 60 * 1000) {
        // Cache is fresh — return stale result without hitting X API
        return c.json({
          success: true,
          data: {
            eligible: false,
            alreadyDelivered: deliveredIds.has(match.xUserId),
            conditions: match.conditions,
            message: '条件を満たしていません。しばらく待ってから再度お試しください。',
            cached: true,
          },
        });
      }
      const updatedConditions = { ...match.conditions };
      let needsApiCheck = false;
      const clientResult = await buildXClientForGate(c.env.DB, gate);

      // Try D1 follower_id_cache first (zero X API cost). Unlike the generic
      // followers table (which also holds delivered users from non-follow
      // gates), this cache is populated only from real getFollowers syncs,
      // so a hit is genuine follow proof.
      if (match.conditions.follow === false && gate.require_follow) {
        const cachedFollower = clientResult
          ? await c.env.DB.prepare(
              'SELECT 1 FROM follower_id_cache WHERE x_account_id = ? AND follower_x_user_id = ?',
            ).bind(clientResult.account.x_user_id, match.xUserId).first()
          : null;
        if (cachedFollower) {
          updatedConditions.follow = true;
        } else {
          needsApiCheck = true; // Not in cache — might be a new follower, check X API
        }
      }
      if (match.conditions.like === false && gate.require_like) needsApiCheck = true;
      if (match.conditions.repost === false && gate.require_repost) needsApiCheck = true;

      // Only call X API if D1 couldn't resolve all failed conditions
      let recheckFailed = false;
      if (needsApiCheck && clientResult) {
        try {
          const meter = createUsageMeter();
          const freshCache = new EngagementCache(meter.track);
          // Skip the follower fetch when D1 already confirmed the follow
          const gateForCheck = updatedConditions.follow === true && gate.require_follow
            ? { ...gate, require_follow: 0 }
            : gate;
          let freshConditions;
          try {
            freshConditions = await checkConditions(
              clientResult.xClient, freshCache, gateForCheck, match.xUserId, clientResult.account.x_user_id,
            );
          } finally {
            // Calls made before a failure are still billable — always flush
            c.executionCtx.waitUntil(meter.flush(c.env.DB, gate.x_account_id));
          }
          if (updatedConditions.follow === false && gate.require_follow) {
            updatedConditions.follow = freshConditions.follow;
          }
          if (match.conditions.like === false && gate.require_like) {
            updatedConditions.like = freshConditions.like;
          }
          if (match.conditions.repost === false && gate.require_repost) {
            updatedConditions.repost = freshConditions.repost;
          }
        } catch {
          // X API error — continue with what we have
          recheckFailed = true;
        }
      }

      const nowEligible = (updatedConditions.repost !== false)
        && (updatedConditions.like !== false)
        && (updatedConditions.follow !== false);

      // Persist refreshed conditions and timestamp even when still ineligible,
      // so the 2-minute guard above actually throttles repeat submits.
      // Skip after a FAILED re-check though — bumping cached_at there would
      // lock a possibly-now-eligible user out for 2 minutes on stale data.
      if (!recheckFailed) {
        await c.env.DB.prepare(
          'UPDATE replier_cache SET eligible = ?, conditions_json = ?, cached_at = ? WHERE gate_id = ? AND x_user_id = ?',
        ).bind(nowEligible ? 1 : 0, JSON.stringify(updatedConditions), new Date().toISOString(), gateId, match.xUserId).run();
      }

      if (nowEligible && gate.action_type === 'verify_only' && !deliveredIds.has(match.xUserId)) {
        await createDelivery(c.env.DB, gateId, match.xUserId, match.username, null, 'delivered');
      }

      return c.json({
        success: true,
        data: {
          eligible: nowEligible,
          alreadyDelivered: deliveredIds.has(match.xUserId),
          conditions: updatedConditions,
          ...(nowEligible ? {} : { message: '条件を満たしていません' }),
        },
      });
    }
    // User not in cache — they may have reposted after cache was created.
    // Rate limit refresh: check when the gate cache was last fully refreshed.
    const lastRefreshAge = markerAgeMs(await getMarker(c.env.DB, `gate_cache_refresh:${gateId}`));
    if (lastRefreshAge < 2 * 60 * 1000) {
      // Cache was recently refreshed — user genuinely hasn't engaged yet
      return c.json({
        success: true,
        data: {
          eligible: false,
          conditions: { repost: false, like: null, follow: null, reply: null },
          message: `${triggerLabel(gate.trigger_type)}が確認できません。1〜2分待ってから再度お試しください。`,
        },
      });
    }
    const clientForRefresh = await buildXClientForGate(c.env.DB, gate);
    if (clientForRefresh) {
      try {
        const fresh = await fetchAndCacheDeduped(c.env.DB, clientForRefresh.xClient, gate, clientForRefresh.account.x_user_id);
        const freshMatch = fresh.find((r) => r.username.toLowerCase() === username.toLowerCase());
        if (freshMatch) {
          if (freshMatch.eligible && gate.action_type === 'verify_only' && !deliveredIds.has(freshMatch.xUserId)) {
            await createDelivery(c.env.DB, gateId, freshMatch.xUserId, freshMatch.username, null, 'delivered');
          }
          return c.json({
            success: true,
            data: {
              eligible: freshMatch.eligible,
              conditions: freshMatch.conditions,
              ...(freshMatch.eligible ? {} : { message: '条件を満たしていません' }),
            },
          });
        }
      } catch {
        // X API error — fall through to "not found"
      }
    }

    return c.json({
      success: true,
      data: {
        eligible: false,
        conditions: { repost: false, like: null, follow: null, reply: null },
        message: `${triggerLabel(gate.trigger_type)}が確認できません`,
      },
    });
  }

  // ─── Cache miss: fetch from X API ───
  const clientResult = await buildXClientForGate(c.env.DB, gate);
  if (!clientResult) return c.json({ success: false, error: 'X account not found' }, 500);

  try {
    const engagers = await fetchAndCacheDeduped(c.env.DB, clientResult.xClient, gate, clientResult.account.x_user_id);
    const match = engagers.find((r) => r.username.toLowerCase() === username.toLowerCase());

    if (!match) {
      return c.json({
        success: true,
        data: {
          eligible: false,
          conditions: { repost: false, like: null, follow: null, reply: null },
          message: `${triggerLabel(gate.trigger_type)}が確認できません`,
        },
      });
    }

    if (match.eligible && gate.action_type === 'verify_only' && !deliveredIds.has(match.xUserId)) {
      await createDelivery(c.env.DB, gateId, match.xUserId, match.username, null, 'delivered');
    }

    return c.json({
      success: true,
      data: {
        eligible: match.eligible,
        conditions: match.conditions,
        ...(match.eligible ? {} : { message: '条件を満たしていません' }),
      },
    });
  } catch (err) {
    console.error('Verify fetch error:', err);
    return c.json({ success: false, error: 'X API エラー。しばらく後に再試行してください。' }, 503);
  }
});

// ─── GET /repliers — list eligible engagers (cached) ───

verify.get('/api/engagement-gates/:id/repliers', async (c) => {
  const gateId = c.req.param('id');

  const gate = await getEngagementGateById(c.env.DB, gateId);
  if (!gate) return c.json({ success: false, error: 'Gate not found' }, 404);
  if (!gate.is_active) return c.json({ success: false, error: 'This gate is no longer active' }, 400);

  // ─── Try cache first ───
  // "Warmed" means a full fetchAndCache completed (gate_cache_refresh marker),
  // NOT that rows merely exist — single verifies also write rows, and treating
  // those as a complete cache would serve a partial repliers list forever.
  const warmed = await getMarker(c.env.DB, `gate_cache_refresh:${gateId}`);
  const cached = warmed ? await getCachedEngagers(c.env.DB, gateId) : null;
  if (cached) {
    return c.json({
      success: true,
      data: cached.filter((r) => r.eligible).map((r) => ({
        username: r.username, displayName: r.displayName,
        profileImageUrl: r.profileImageUrl, eligible: r.eligible,
      })),
      cached: true,
    });
  }

  // ─── Cache miss: fetch and cache ───
  const clientResult = await buildXClientForGate(c.env.DB, gate);
  if (!clientResult) return c.json({ success: false, error: 'X account not found' }, 500);

  try {
    const engagers = await fetchAndCacheDeduped(c.env.DB, clientResult.xClient, gate, clientResult.account.x_user_id);
    return c.json({
      success: true,
      data: engagers.filter((r) => r.eligible).map((r) => ({
        username: r.username, displayName: r.displayName,
        profileImageUrl: r.profileImageUrl, eligible: r.eligible,
      })),
    });
  } catch (err) {
    console.error('GET repliers error:', err);
    return c.json({ success: false, error: 'Failed to fetch engagers' }, 500);
  }
});

export { verify };
