import { Hono } from 'hono';
import { getEngagementGateById, getDeliveredUserIds, getXAccounts, createDelivery } from '@x-harness/db';
import type { Env } from '../index.js';
import { EngagementCache, checkConditions } from '../services/reply-trigger-cache.js';
import { XClient } from '@x-harness/x-sdk';

const verify = new Hono<Env>();

// ─── Cache helpers ───

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

async function setCachedEngagers(db: D1Database, gateId: string, engagers: CachedEngager[]): Promise<void> {
  if (engagers.length === 0) return;

  // UPSERT: add new engagers, update existing ones. Never delete —
  // getRetweetedBy only returns ~100 users per call, but returns a
  // slightly different set each time. By accumulating, the cache
  // eventually covers all retweeters.
  const now = new Date().toISOString();
  for (const r of engagers) {
    await db
      .prepare(`INSERT INTO replier_cache (gate_id, x_user_id, username, display_name, profile_image_url, eligible, conditions_json, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (gate_id, x_user_id) DO UPDATE SET
          username = excluded.username,
          display_name = excluded.display_name,
          profile_image_url = excluded.profile_image_url,
          eligible = excluded.eligible,
          conditions_json = excluded.conditions_json,
          cached_at = excluded.cached_at`)
      .bind(gateId, r.xUserId, r.username, r.displayName, r.profileImageUrl, r.eligible ? 1 : 0, JSON.stringify(r.conditions), now)
      .run();
  }
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
  const deliveredIds = await getDeliveredUserIds(db, gate.id);
  const cache = new EngagementCache();
  const engagers: CachedEngager[] = [];

  if (gate.trigger_type === 'repost') {
    // ─── Repost trigger: getRetweetedBy (no spam filter) ───
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
  } else if (gate.trigger_type === 'like') {
    // ─── Like trigger: getLikingUsers ───
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

  // ─── Try cache first (no X API call) ───
  const cached = await getCachedEngagers(c.env.DB, gateId);
  if (cached) {
    const match = cached.find((r) => r.username.toLowerCase() === username.toLowerCase());
    if (match) {
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
      const clientResult = await buildXClientForGate(c.env.DB, gate);
      if (clientResult) {
        try {
          const freshCache = new EngagementCache();
          const freshConditions = await checkConditions(
            clientResult.xClient, freshCache, gate, match.xUserId, clientResult.account.x_user_id,
          );
          // Keep the trigger condition from cache (repost/like/reply = already confirmed)
          const updatedConditions = { ...match.conditions };
          if (match.conditions.follow === false && gate.require_follow) {
            updatedConditions.follow = freshConditions.follow;
          }
          if (match.conditions.like === false && gate.require_like) {
            updatedConditions.like = freshConditions.like;
          }
          if (match.conditions.repost === false && gate.require_repost) {
            updatedConditions.repost = freshConditions.repost;
          }

          const nowEligible = (updatedConditions.repost !== false)
            && (updatedConditions.like !== false)
            && (updatedConditions.follow !== false);

          // Update cache entry if now eligible
          if (nowEligible) {
            await c.env.DB.prepare(
              'UPDATE replier_cache SET eligible = 1, conditions_json = ?, cached_at = ? WHERE gate_id = ? AND x_user_id = ?',
            ).bind(JSON.stringify(updatedConditions), new Date().toISOString(), gateId, match.xUserId).run();

            if (gate.action_type === 'verify_only' && !deliveredIds.has(match.xUserId)) {
              await createDelivery(c.env.DB, gateId, match.xUserId, match.username, null, 'delivered');
            }
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
        } catch {
          // X API error — return stale cache rather than failing
        }
      }

      return c.json({
        success: true,
        data: {
          eligible: false,
          alreadyDelivered: deliveredIds.has(match.xUserId),
          conditions: match.conditions,
          message: '条件を満たしていません',
          cached: true,
        },
      });
    }
    // User not in cache — they may have reposted after cache was created.
    // Refresh cache (1 API call) instead of telling user to wait.
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
  const cached = await getCachedEngagers(c.env.DB, gateId);
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
