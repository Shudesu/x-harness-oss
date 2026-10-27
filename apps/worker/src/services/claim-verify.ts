import type { XClient } from '@x-harness/x-sdk';
import type { ClaimGate, ClaimCode, ClaimAuthor } from './claim-types.js';
export async function gateSpend(db: D1Database, gateId: string) {
  return (
    (
      await db
        .prepare(
          "SELECT COALESCE(SUM(cost_usd),0) AS total FROM api_spend_ledger WHERE source='x' AND feature=?",
        )
        .bind(`claim:${gateId}`)
        .first<{ total: number }>()
    )?.total ?? 0
  );
}
export async function verifyClaimConditions(
  db: D1Database,
  client: XClient,
  gate: ClaimGate,
  claim: ClaimCode,
  now = Date.now(),
  likes?: { load: () => Promise<{ ids: Set<string>; unverifiable: boolean }> },
): Promise<{ ok: boolean; missing: string[]; retryAt?: number; note?: string }> {
  if (gate.tier === 'simple') return { ok: true, missing: [] };
  if (!claim.x_user_id || !claim.author_json) return { ok: false, missing: ['reply'] };
  const author = JSON.parse(claim.author_json) as ClaimAuthor;
  if (gate.tier === 'strict' && (author.public_metrics?.followers_count ?? 0) < gate.min_followers)
    return { ok: false, missing: ['followers_count'] };
  if (gate.follow_policy === 'verify_winners') {
    const cached = await db
      .prepare(
        "SELECT value,retry_at,attempts FROM gate_condition_cache WHERE gate_id=? AND x_user_id=? AND condition='follow'",
      )
      .bind(gate.id, claim.x_user_id)
      .first<{ value: number; retry_at: number | null; attempts: number }>();
    if (!cached?.value) {
      if (cached?.retry_at && cached.retry_at > now)
        return { ok: false, missing: ['follow'], retryAt: cached.retry_at };
      if ((await gateSpend(db, gate.id)) >= gate.budget_usd)
        return { ok: false, missing: ['budget'], retryAt: now + 300000 };
      const user = await client.getRelationshipById(claim.x_user_id);
      if (!Array.isArray(user.connection_status))
        return { ok: false, missing: ['follow_unavailable'], retryAt: now + 300000 };
      const value = user.connection_status.includes('followed_by'),
        attempts = (cached?.attempts ?? 0) + 1;
      const retry = value ? null : now + [30000, 120000, 600000][Math.min(attempts - 1, 2)];
      await db
        .prepare(
          "INSERT INTO gate_condition_cache(gate_id,x_user_id,condition,value,checked_at,retry_at,attempts) VALUES (?,?,'follow',?,?,?,?) ON CONFLICT(gate_id,x_user_id,condition) DO UPDATE SET value=excluded.value,checked_at=excluded.checked_at,retry_at=excluded.retry_at,attempts=excluded.attempts",
        )
        .bind(gate.id, claim.x_user_id, value ? 1 : 0, now, retry, attempts)
        .run();
      if (!value) return { ok: false, missing: ['follow'], retryAt: retry! };
    }
  }
  if (gate.tier === 'strict') {
    if ((await gateSpend(db, gate.id)) >= gate.budget_usd)
      return { ok: false, missing: ['budget'], retryAt: now + 300000 };
    const posts = await client.getTweets([claim.reply_tweet_id!]);
    if (!posts.some((p) => p.id === claim.reply_tweet_id && p.author_id === claim.x_user_id))
      return { ok: false, missing: ['reply_deleted'] };
  }
  let note: string | undefined;
  if (gate.like_policy === 'verify_winners' && likes) {
    const page = await likes.load(),
      liked = page.ids.has(claim.x_user_id);
    await db
      .prepare(
        "INSERT INTO gate_condition_cache(gate_id,x_user_id,condition,value,checked_at) VALUES (?,?,'like',?,?) ON CONFLICT(gate_id,x_user_id,condition) DO UPDATE SET value=excluded.value,checked_at=excluded.checked_at",
      )
      .bind(gate.id, claim.x_user_id, liked ? 1 : 0, now)
      .run();
    if (!liked) {
      if (page.unverifiable) note = 'like_unverifiable';
      else if (gate.tier === 'strict')
        return { ok: false, missing: ['like'], retryAt: now + 120000 };
      else note = 'like_not_confirmed';
    }
  }
  return { ok: true, missing: [], note };
}
