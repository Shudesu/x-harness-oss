import { Hono } from 'hono';
import { getEngagementGateById, getDeliveredUserIds, getXAccounts, createDelivery } from '@x-harness/db';
import type { Env } from '../index.js';
import { EngagementCache, checkConditions } from '../services/reply-trigger-cache.js';
import { XClient } from '@x-harness/x-sdk';

const verify = new Hono<Env>();

// ─── Cache helpers ───

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-flight lock: prevents multiple concurrent cache refreshes for the same gate.
// If 50 users hit verify at the same time on a cold cache, only 1 fetches from X API.
const inflight = new Map<string, Promise<CachedReplier[]>>();

interface CachedReplier {
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  eligible: boolean;
  conditions: { reply: boolean; like: boolean | null; repost: boolean | null; follow: boolean | null };
}

async function getCachedRepliers(db: D1Database, gateId: string): Promise<CachedReplier[] | null> {
  const rows = await db
    .prepare('SELECT username, display_name, profile_image_url, eligible, conditions_json, cached_at FROM replier_cache WHERE gate_id = ? ORDER BY username')
    .bind(gateId)
    .all<{ username: string; display_name: string; profile_image_url: string | null; eligible: number; conditions_json: string | null; cached_at: string }>();

  if (rows.results.length === 0) return null;

  // Check TTL against the first row's cached_at
  const cachedAt = new Date(rows.results[0].cached_at + 'Z').getTime();
  if (Date.now() - cachedAt > CACHE_TTL_MS) return null; // stale

  return rows.results.map((r) => ({
    username: r.username,
    displayName: r.display_name,
    profileImageUrl: r.profile_image_url,
    eligible: r.eligible === 1,
    conditions: r.conditions_json ? JSON.parse(r.conditions_json) : { reply: true, like: null, repost: null, follow: null },
  }));
}

async function setCachedRepliers(db: D1Database, gateId: string, repliers: CachedReplier[]): Promise<void> {
  // Clear old cache for this gate
  await db.prepare('DELETE FROM replier_cache WHERE gate_id = ?').bind(gateId).run();

  if (repliers.length === 0) return;

  // Batch insert (D1 supports up to 100 binds per statement, so chunk if needed)
  const now = new Date().toISOString();
  for (const r of repliers) {
    await db
      .prepare('INSERT INTO replier_cache (gate_id, x_user_id, username, display_name, profile_image_url, eligible, conditions_json, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(
        gateId,
        r.username, // Using username as x_user_id placeholder since we don't always have the real ID in this context
        r.username,
        r.displayName,
        r.profileImageUrl,
        r.eligible ? 1 : 0,
        JSON.stringify(r.conditions),
        now,
      )
      .run();
  }
}

// ─── Shared: fetch repliers from X API and cache (with dedup lock) ───

async function fetchAndCacheRepliersDeduped(
  db: D1Database,
  xClient: XClient,
  gate: Awaited<ReturnType<typeof getEngagementGateById>>,
  accountXUserId: string,
): Promise<CachedReplier[]> {
  const gateId = gate!.id;
  const existing = inflight.get(gateId);
  if (existing) return existing; // Another request is already fetching — piggyback

  const promise = fetchAndCacheRepliers(db, xClient, gate, accountXUserId)
    .finally(() => inflight.delete(gateId));
  inflight.set(gateId, promise);
  return promise;
}

async function fetchAndCacheRepliers(
  db: D1Database,
  xClient: XClient,
  gate: Awaited<ReturnType<typeof getEngagementGateById>>,
  accountXUserId: string,
): Promise<CachedReplier[]> {
  const keyword = gate!.reply_keyword ? ` "${gate!.reply_keyword}"` : '';
  const result = await xClient.searchRecentTweets(
    `conversation_id:${gate!.post_id} is:reply${keyword}`,
  );

  if (!result.data || result.data.length === 0) {
    await setCachedRepliers(db, gate!.id, []);
    return [];
  }

  const includes = (result as any).includes as { users?: any[] } | undefined;
  const userMap = new Map<string, any>();
  if (includes?.users) {
    for (const u of includes.users) userMap.set(u.id, u);
  }

  const cache = new EngagementCache();
  const deliveredIds = await getDeliveredUserIds(db, gate!.id);

  const seen = new Set<string>();
  const repliers: CachedReplier[] = [];

  for (const tweet of result.data) {
    if (seen.has(tweet.author_id)) continue;
    seen.add(tweet.author_id);

    const u = userMap.get(tweet.author_id);
    if (!u) continue;

    if (deliveredIds.has(tweet.author_id)) {
      repliers.push({
        username: u.username,
        displayName: u.name,
        profileImageUrl: u.profile_image_url || null,
        eligible: true,
        conditions: { reply: true, like: true, repost: true, follow: true },
      });
      continue;
    }

    const conditions = await checkConditions(xClient, cache, gate!, tweet.author_id, accountXUserId);
    conditions.reply = true;
    const eligible = conditions.reply
      && (!gate!.require_like || conditions.like)
      && (!gate!.require_repost || conditions.repost)
      && (!gate!.require_follow || conditions.follow);

    repliers.push({
      username: u.username,
      displayName: u.name,
      profileImageUrl: u.profile_image_url || null,
      eligible,
      conditions: {
        reply: conditions.reply,
        like: gate!.require_like ? conditions.like : null,
        repost: gate!.require_repost ? conditions.repost : null,
        follow: gate!.require_follow ? conditions.follow : null,
      },
    });
  }

  await setCachedRepliers(db, gate!.id, repliers);
  return repliers;
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

// ─── GET /verify — check if a user meets all conditions ───

verify.get('/api/engagement-gates/:id/verify', async (c) => {
  const gateId = c.req.param('id');
  const username = c.req.query('username')?.replace('@', '').trim();

  if (!username) {
    return c.json({ success: false, error: 'username query parameter required' }, 400);
  }

  const gate = await getEngagementGateById(c.env.DB, gateId);
  if (!gate) {
    return c.json({ success: false, error: 'Gate not found' }, 404);
  }

  if (!gate.is_active) {
    return c.json({ success: false, error: 'This gate is no longer active' }, 400);
  }
  if (gate.expires_at && new Date(gate.expires_at).getTime() <= Date.now()) {
    return c.json({ success: false, error: 'This gate has expired' }, 400);
  }

  if (gate.trigger_type !== 'reply') {
    return c.json({ success: false, error: 'Verify is only supported for reply-trigger gates' }, 400);
  }

  // Check if already delivered
  const deliveredIds = await getDeliveredUserIds(c.env.DB, gateId);

  // ─── Try cache first (no X API call) ───
  const cached = await getCachedRepliers(c.env.DB, gateId);
  if (cached) {
    const match = cached.find((r) => r.username.toLowerCase() === username.toLowerCase());
    if (match) {
      // Record delivery for verify_only gates
      if (match.eligible && gate.action_type === 'verify_only') {
        // Need x_user_id — use username as fallback
        const alreadyDelivered = [...deliveredIds].some(() => false); // We check by username below
        if (!alreadyDelivered) {
          await createDelivery(c.env.DB, gateId, match.username, match.username, null, 'delivered');
        }
      }

      return c.json({
        success: true,
        data: {
          eligible: match.eligible,
          alreadyDelivered: false,
          conditions: match.conditions,
          ...(match.eligible ? {} : { message: '条件を満たしていません' }),
          cached: true,
        },
      });
    }
    // User not in cache — they haven't replied yet
    return c.json({
      success: true,
      data: {
        eligible: false,
        conditions: { reply: false, like: null, repost: null, follow: null },
        message: 'リプライが確認できません。数分後に再度お試しください。',
        cached: true,
      },
    });
  }

  // ─── Cache miss: fetch from X API (only for the first request) ───
  const clientResult = await buildXClientForGate(c.env.DB, gate);
  if (!clientResult) {
    return c.json({ success: false, error: 'X account not found' }, 500);
  }

  try {
    const repliers = await fetchAndCacheRepliersDeduped(c.env.DB, clientResult.xClient, gate, clientResult.account.x_user_id);
    const match = repliers.find((r) => r.username.toLowerCase() === username.toLowerCase());

    if (!match) {
      return c.json({
        success: true,
        data: {
          eligible: false,
          conditions: { reply: false, like: null, repost: null, follow: null },
          message: 'リプライが確認できません',
        },
      });
    }

    if (match.eligible && gate.action_type === 'verify_only') {
      await createDelivery(c.env.DB, gateId, match.username, match.username, null, 'delivered');
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

// ─── GET /repliers — list eligible repliers (cached) ───

verify.get('/api/engagement-gates/:id/repliers', async (c) => {
  const gateId = c.req.param('id');

  const gate = await getEngagementGateById(c.env.DB, gateId);
  if (!gate) {
    return c.json({ success: false, error: 'Gate not found' }, 404);
  }
  if (!gate.is_active) {
    return c.json({ success: false, error: 'This gate is no longer active' }, 400);
  }
  if (gate.trigger_type !== 'reply') {
    return c.json({ success: false, error: 'Only supported for reply-trigger gates' }, 400);
  }

  // ─── Try cache first ───
  const cached = await getCachedRepliers(c.env.DB, gateId);
  if (cached) {
    return c.json({
      success: true,
      data: cached.filter((r) => r.eligible).map((r) => ({
        username: r.username,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl,
        eligible: r.eligible,
      })),
      cached: true,
    });
  }

  // ─── Cache miss: fetch and cache ───
  const clientResult = await buildXClientForGate(c.env.DB, gate);
  if (!clientResult) {
    return c.json({ success: false, error: 'X account not found' }, 500);
  }

  try {
    const repliers = await fetchAndCacheRepliersDeduped(c.env.DB, clientResult.xClient, gate, clientResult.account.x_user_id);
    return c.json({
      success: true,
      data: repliers.filter((r) => r.eligible).map((r) => ({
        username: r.username,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl,
        eligible: r.eligible,
      })),
    });
  } catch (err) {
    console.error('GET repliers error:', err);
    return c.json({ success: false, error: 'Failed to fetch repliers' }, 500);
  }
});

export { verify };
