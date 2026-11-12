import twitterText from 'twitter-text';
import { jstNow } from '@x-harness/db';

// Pre-send length check shared by immediate, thread, scheduled and approved
// posts:
//  - weighted length (X counts CJK/emoji as 2, every URL as 23)
//  - plan-aware limit: every paid tier (Basic / Premium / Premium+) may post
//    up to 25,000 characters (https://help.x.com/en/using-x/x-premium); the
//    API docs say "At most 280 characters unless the account has X Premium"
//    (https://docs.x.com/x-api/posts/create-post). X stays the final judge.

export const STANDARD_LIMIT = 280;
export const PREMIUM_LIMIT = 25000;

export const PLAN_CHAR_LIMITS: Record<string, number> = {
  None: STANDARD_LIMIT,
  Basic: PREMIUM_LIMIT,
  Premium: PREMIUM_LIMIT,
  PremiumPlus: PREMIUM_LIMIT,
};

export function charLimitForPlan(subscriptionType: string | null | undefined): number {
  return PLAN_CHAR_LIMITS[subscriptionType ?? 'None'] ?? STANDARD_LIMIT;
}

/** X's weighted character count, from X's own twitter-text parser (v3 rules: URL = 23, CJK/emoji = 2). */
export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

// ─── plan lookup (cached in settings to avoid a paid read per post) ───

export interface PlanInfo {
  subscriptionType: string;
  charLimit: number;
  checkedAt: string;
}

const PLAN_CACHE_TTL_MS = 24 * 60 * 60_000;
const planKey = (accountId: string) => `x_plan:${accountId}`;

export interface PlanSource {
  getMeWithSubscription(): Promise<{ subscription_type?: string }>;
}

async function readCachedPlan(db: D1Database, accountId: string): Promise<PlanInfo | null> {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(planKey(accountId)).first<{ value: string }>();
    if (!row) return null;
    const v = JSON.parse(row.value) as PlanInfo;
    if (typeof v.subscriptionType !== 'string' || typeof v.checkedAt !== 'string') return null;
    // Re-derive the limit so entries cached under older limits stay correct.
    return { ...v, charLimit: charLimitForPlan(v.subscriptionType) };
  } catch {
    return null;
  }
}

async function writeCachedPlan(db: D1Database, accountId: string, plan: PlanInfo): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(planKey(accountId), JSON.stringify(plan), jstNow())
      .run();
  } catch {
    // cache only
  }
}

export function planFromSubscription(subscriptionType: string | null | undefined): PlanInfo {
  const type = subscriptionType ?? 'None';
  return { subscriptionType: type, charLimit: charLimitForPlan(type), checkedAt: new Date().toISOString() };
}

/** Stores a freshly fetched plan (e.g. from GET /api/x-accounts/:id/subscription). */
export async function rememberPlan(db: D1Database, accountId: string, subscriptionType: string | null | undefined): Promise<PlanInfo> {
  const plan = planFromSubscription(subscriptionType);
  await writeCachedPlan(db, accountId, plan);
  return plan;
}

// An expired cache may only loosen the check: a stale restrictive plan (the
// account may have upgraded since) counts as unknown, never as a rejection.
function staleFallback(cached: PlanInfo | null): PlanInfo | null {
  return cached && cached.charLimit > STANDARD_LIMIT ? cached : null;
}

/** Plan for the account: fresh cache, else X lookup, else stale cache, else null. */
export async function getAccountPlan(db: D1Database, client: PlanSource, accountId: string): Promise<PlanInfo | null> {
  const cached = await readCachedPlan(db, accountId);
  if (cached && Date.now() - new Date(cached.checkedAt).getTime() < PLAN_CACHE_TTL_MS) return cached;
  try {
    const me = await client.getMeWithSubscription();
    // No subscription_type in the answer = plan unknown, not "None": don't
    // cache it, so the caller falls back to the allow-with-warning path.
    if (typeof me.subscription_type !== 'string' || !me.subscription_type) return staleFallback(cached);
    return await rememberPlan(db, accountId, me.subscription_type);
  } catch {
    return staleFallback(cached);
  }
}

export interface LengthCheck {
  ok: boolean;
  weightedLength: number;
  limit: number | null;
  plan: string | null;
  error?: string;
  warning?: string;
}

/**
 * Validates the text against the account's plan. Only looks the plan up when
 * the text is over 280, so normal posts cost nothing extra. `client` may be a
 * factory so routes that don't otherwise need an X client only build one for
 * long text. When the plan
 * cannot be determined the post is allowed (X stays the final judge) with a
 * warning — a transient lookup failure must not block posts.
 */
export async function checkTextLength(
  db: D1Database,
  client: PlanSource | (() => Promise<PlanSource>),
  accountId: string,
  text: string,
): Promise<LengthCheck> {
  const weighted = weightedLength(text);
  if (weighted <= STANDARD_LIMIT) return { ok: true, weightedLength: weighted, limit: STANDARD_LIMIT, plan: null };
  const source: PlanSource = typeof client === 'function'
    ? { getMeWithSubscription: async () => (await client()).getMeWithSubscription() }
    : client;
  const plan = await getAccountPlan(db, source, accountId);
  if (!plan) {
    return {
      ok: true,
      weightedLength: weighted,
      limit: null,
      plan: null,
      warning: `本文が${weighted}字（日本語=2・URL=23で換算）で280字を超えていますが、プランを確認できませんでした。X Premium でない場合はXに拒否されます。`,
    };
  }
  if (weighted <= plan.charLimit) return { ok: true, weightedLength: weighted, limit: plan.charLimit, plan: plan.subscriptionType };
  const error = plan.charLimit <= STANDARD_LIMIT
    ? `本文が長すぎます: ${weighted}字（日本語=2・URL=23で換算）。このアカウントは X Premium ではないため上限は280字です。`
    : `本文が長すぎます: ${weighted}字（日本語=2・URL=23で換算）。プラン ${plan.subscriptionType} の上限は${plan.charLimit}字です。`;
  return { ok: false, weightedLength: weighted, limit: plan.charLimit, plan: plan.subscriptionType, error };
}

export function tooLongResponseBody(length: LengthCheck, extra: Record<string, unknown> = {}) {
  return {
    success: false as const,
    error: length.error,
    code: 'TEXT_TOO_LONG' as const,
    data: { weightedLength: length.weightedLength, limit: length.limit, plan: length.plan, ...extra },
  };
}
