import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWranglerBoundaries } from './lib/check-wrangler-boundaries.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const checker = fileURLToPath(new URL('./check-phase1-boundaries.mjs', import.meta.url));

describe('boundary checker CLI', () => {
  it('accepts the reviewed Phase 3 deployment while retaining the inert Phase 1 surfaces', () => {
    const output = execFileSync(process.execPath, [checker], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('boundary check passed');
  });

  it('rejects Phase 3 without release gates or an allowlisted scheduling policy', () => {
    const violations = validateWranglerBoundaries(`
[env.production.vars]
CUBELIC_SAFE_MODE = "true"
CUBELIC_PHASE3_ENABLED = "true"
GLOBAL_PUBLISHING_DISABLED = "false"
CUBELIC_PHASE3_DELIVERY_MODE = "x"
PHASE3_RELEASE_APPROVED = "false"
STAGING_PHASE3_SMOKE_VERIFIED = "false"
CUBELIC_PHASE3_SCHEDULE_POLICIES = "dm_campaign:unsafe"
`);

    expect(violations).toEqual([
      'apps/worker/wrangler.toml: env.production Phase 3 requires release approval and verified staging smoke',
      'apps/worker/wrangler.toml: env.production Phase 3 schedule policies must be explicit reviewed category:template_id pairs',
    ]);
  });

  it('rejects staging fake delivery on any non-dedicated Worker URL', () => {
    const violations = validateWranglerBoundaries(`
[env.staging.vars]
WORKER_URL = "https://x-harness-worker-staging.evil.example"
CUBELIC_SAFE_MODE = "true"
CUBELIC_PHASE3_ENABLED = "true"
GLOBAL_PUBLISHING_DISABLED = "false"
CUBELIC_PHASE3_DELIVERY_MODE = "staging_fake"
PHASE3_RELEASE_APPROVED = "true"
STAGING_PHASE3_SMOKE_VERIFIED = "true"
CUBELIC_PHASE3_SCHEDULE_POLICIES = "event_notice:event_notice_manual_v1"
`);

    expect(violations).toEqual([
      'apps/worker/wrangler.toml: env.staging staging_fake delivery requires the exact dedicated staging Worker URL',
    ]);
  });
});
