import { validMessageTemplates } from './campaign-display.js';
import { validateConditionPolicies } from './campaign-policies.js';
export type Validation = { ok: boolean; errors: Array<{ field: string; code: string }> };
const invalid = (field: string, code: string): Validation => ({
  ok: false,
  errors: [{ field, code }],
});
export function validateCampaignInput(body: Record<string, any>, now = Date.now()): Validation {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return invalid('configuration', 'Invalid body');
  if (body.requireFollow !== undefined && typeof body.requireFollow !== 'boolean')
    return invalid('configuration', 'Invalid follow condition');
  if (
    body.scenarios !== undefined &&
    (!body.scenarios ||
      typeof body.scenarios !== 'object' ||
      Array.isArray(body.scenarios) ||
      Object.entries(body.scenarios).some(
        ([key, value]) => !['claimed', 'won', 'lost'].includes(key) || typeof value !== 'string',
      ))
  )
    return invalid('configuration', 'Invalid scenarios');
  const tier = body.tier ?? 'standard',
    age = body.minAccountAgeDays ?? (tier === 'strict' ? 30 : 7),
    settle = body.settleSec ?? (tier === 'strict' ? 180 : 60),
    budget = body.budgetUsd ?? 10;
  if (
    typeof body.slug !== 'string' ||
    !/^[a-z0-9-]{2,64}$/.test(body.slug) ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.length > 100 ||
    typeof body.claimPhrase !== 'string' ||
    !/^[\p{L}\p{N}]{2,8}$/u.test(body.claimPhrase) ||
    !['simple', 'standard', 'strict'].includes(tier) ||
    !['first_come', 'lottery'].includes(body.awardMode ?? 'first_come') ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > 3650 ||
    (tier === 'strict' && age < 30) ||
    !Number.isInteger(settle) ||
    settle < 0 ||
    settle > 300 ||
    !Number.isFinite(budget) ||
    budget < 0 ||
    budget > 100000 ||
    typeof body.postId !== 'string' ||
    !/^\d{1,25}$/.test(body.postId) ||
    typeof body.endsAt !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(body.endsAt) ||
    !Number.isFinite(Date.parse(body.endsAt)) ||
    Date.parse(body.endsAt) <= now
  )
    return invalid('configuration', 'Invalid campaign configuration');
  if (!Array.isArray(body.rewards) || body.rewards.length < 1 || body.rewards.length > 10)
    return invalid('configuration', '1–10 reward tiers required');
  for (const reward of body.rewards) {
    if (
      !reward ||
      typeof reward.label !== 'string' ||
      reward.label.length > 100 ||
      !reward.label ||
      (reward.consolation !== undefined && typeof reward.consolation !== 'boolean') ||
      !['coupon_code', 'url', 'line_message', 'file'].includes(reward.type) ||
      typeof reward.value !== 'string' ||
      reward.value.length > 2000 ||
      (reward.quota !== null && (!Number.isSafeInteger(reward.quota) || reward.quota < 0)) ||
      !Number.isFinite(reward.weight ?? 1) ||
      (reward.weight ?? 1) < 0 ||
      (reward.weight ?? 1) > 1000000 ||
      (reward.unitCost !== undefined && (!Number.isFinite(reward.unitCost) || reward.unitCost < 0))
    )
      return invalid('configuration', 'Invalid reward');
    if (['url', 'file'].includes(reward.type)) {
      try {
        if (new URL(reward.value).protocol !== 'https:') throw new Error();
      } catch {
        return invalid('configuration', 'Reward URLs must be HTTPS');
      }
    }
    if (
      reward.type === 'coupon_code' &&
      (!Array.isArray(reward.codes) ||
        !reward.codes.length ||
        reward.codes.length > 1000 ||
        reward.codes.some((x: unknown) => typeof x !== 'string' || !x || x.length > 200))
    )
      return invalid('configuration', 'Coupon code list required (max 1000)');
  }
  if (
    tier === 'simple' &&
    !body.rewards.some((r: any) => r.quota === null && r.type !== 'coupon_code')
  )
    return invalid(
      'configuration',
      'Simple tier requires an unlimited non-code participation reward',
    );
  if (
    body.awardMode === 'lottery' &&
    body.rewards.reduce((sum: number, r: any) => sum + (r.weight ?? 1), 0) <= 0
  )
    return invalid('configuration', 'Lottery weights must have a positive total');
  if (
    body.minFollowers !== undefined &&
    (!Number.isInteger(body.minFollowers) || body.minFollowers < 0 || body.minFollowers > 100000000)
  )
    return invalid('configuration', 'Invalid follower count');
  if (
    body.replyHashtag !== undefined &&
    body.replyHashtag !== '' &&
    (typeof body.replyHashtag !== 'string' ||
      !/^[\p{L}\p{N}_]{1,40}$/u.test(body.replyHashtag.replace(/^#/, '')))
  )
    return invalid('configuration', 'Invalid hashtag');
  for (const value of [body.postCostUsd, body.externalCostUsd])
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      return invalid('configuration', 'Invalid campaign cost');
  const policy = validateConditionPolicies(body);
  if (policy) return invalid('followPolicy', policy);
  if (!validMessageTemplates(body.messageTemplates))
    return invalid('messageTemplates', 'Invalid placeholders');
  return { ok: true, errors: [] };
}
