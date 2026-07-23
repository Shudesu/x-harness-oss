export function validateWranglerBoundaries(wrangler) {
  const violations = [];
  const environmentVariables = [...wrangler.matchAll(
    /^\[env\.([^.]+)\.vars\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm,
  )].map((match) => {
    const values = Object.fromEntries(
      [...match[2].matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"$/gm)]
        .map((entry) => [entry[1], entry[2]]),
    );
    return { environment: match[1], values };
  });
  if (environmentVariables.length === 0) {
    violations.push('apps/worker/wrangler.toml: no environment variable tables were found');
  }
  for (const { environment, values } of environmentVariables) {
    const prefix = `apps/worker/wrangler.toml: env.${environment}`;
    if (values.CUBELIC_SAFE_MODE !== 'true') {
      violations.push(`${prefix} must keep CUBELIC_SAFE_MODE=true`);
    }
    if (values.CUBELIC_PHASE3_ENABLED === 'true') {
      if (values.GLOBAL_PUBLISHING_DISABLED !== 'false') {
        violations.push(`${prefix} Phase 3 requires GLOBAL_PUBLISHING_DISABLED=false`);
      }
      if (values.PHASE3_RELEASE_APPROVED !== 'true' || values.STAGING_PHASE3_SMOKE_VERIFIED !== 'true') {
        violations.push(`${prefix} Phase 3 requires release approval and verified staging smoke`);
      }
      const expectedDeliveryMode = environment === 'staging' ? 'staging_fake' : 'x';
      if (values.CUBELIC_PHASE3_DELIVERY_MODE !== expectedDeliveryMode) {
        violations.push(`${prefix} Phase 3 delivery mode must be ${expectedDeliveryMode}`);
      }
      const policies = (values.CUBELIC_PHASE3_SCHEDULE_POLICIES ?? '')
        .split(',')
        .map((policy) => policy.trim())
        .filter(Boolean);
      if (policies.length === 0 || policies.some((policy) => !/^(event_notice|event_reminder|youtube_notice):[A-Za-z0-9_-]+$/.test(policy))) {
        violations.push(`${prefix} Phase 3 schedule policies must be explicit reviewed category:template_id pairs`);
      }
      if (
        environment === 'staging'
        && values.WORKER_URL !== 'https://x-harness-worker-staging.yoshihiro-fukiya.workers.dev'
      ) {
        violations.push(`${prefix} staging_fake delivery requires the exact dedicated staging Worker URL`);
      }
    } else {
      if (values.CUBELIC_PHASE3_ENABLED !== 'false') {
        violations.push(`${prefix} must set CUBELIC_PHASE3_ENABLED to true or false exactly`);
      }
      if (values.GLOBAL_PUBLISHING_DISABLED !== 'true') {
        violations.push(`${prefix} Phase 1 requires GLOBAL_PUBLISHING_DISABLED=true`);
      }
    }
  }
  return violations;
}
