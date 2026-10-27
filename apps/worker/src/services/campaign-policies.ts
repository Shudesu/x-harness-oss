export function conditionPolicies(body: Record<string, any>) {
  return {
    follow:
      body.followPolicy ??
      (body.requireFollow || body.tier === 'strict' ? 'verify_winners' : 'none'),
    like: body.likePolicy ?? 'none',
  };
}
export function validateConditionPolicies(body: Record<string, any>): string | null {
  const p = conditionPolicies(body);
  if (![p.follow, p.like].every((x) => ['none', 'ask', 'verify_winners'].includes(x)))
    return 'Invalid condition policy';
  if (body.verifyConditionsOptIn !== undefined && typeof body.verifyConditionsOptIn !== 'boolean')
    return 'Invalid condition opt-in';
  if ((p.follow === 'verify_winners' || p.like === 'verify_winners') && body.tier === 'simple')
    return 'Simple campaigns cannot verify X conditions; use ask';
  if (
    (p.follow === 'verify_winners' || p.like === 'verify_winners') &&
    body.tier !== 'strict' &&
    body.verifyConditionsOptIn !== true
  )
    return 'Condition verification requires explicit opt-in and extra API cost. お願い（ask）を推奨します。';
  if (
    body.requireFollow === true &&
    body.followPolicy !== undefined &&
    body.followPolicy !== 'verify_winners'
  )
    return 'Conflicting follow policies';
  return null;
}
