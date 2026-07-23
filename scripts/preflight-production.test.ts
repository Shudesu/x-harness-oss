import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const phase1Environment = {
  API_KEY: 'a'.repeat(32),
  HUMAN_APPROVAL_KEY: 'b'.repeat(32),
  CLOUDFLARE_AUTH_VERIFIED: 'true',
  X_HARNESS_ACCOUNT_ID: '89f9bfc0-428c-480b-9cb3-9ba1698c30da',
  CUBELIC_SAFE_MODE: 'true',
  CUBELIC_PHASE3_DELIVERY_MODE: 'x',
  GLOBAL_PUBLISHING_DISABLED: 'true',
  STAGING_SMOKE_VERIFIED: 'true',
  CORS_ALLOWED_ORIGINS: 'https://ops.cubelic-fan.com',
};

function preflight(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/preflight-production.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...phase1Environment,
      ...overrides,
    },
  });
}

describe('production preflight phase boundaries', () => {
  it('allows the Phase 1 shell without Hermes runtime or real production content inputs', () => {
    const result = preflight();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Production preflight passed for the Phase 1 runtime');
  });

  it('requires a distinct Hermes token only when Hermes runtime is enabled', () => {
    const missing = preflight({ HERMES_RUNTIME_ENABLED: 'true' });
    const reused = preflight({ HERMES_RUNTIME_ENABLED: 'true', HERMES_ACCESS_TOKEN: phase1Environment.API_KEY });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('missing secret environment variable: HERMES_ACCESS_TOKEN');
    expect(reused.status).toBe(1);
    expect(reused.stderr).toContain('API_KEY, HUMAN_APPROVAL_KEY, HERMES_ACCESS_TOKEN must be distinct');
  });

  it('requires real input validation only when production content ingestion is enabled', () => {
    const missing = preflight({ PRODUCTION_CONTENT_INGEST_ENABLED: 'true' });
    const inputsOnly = preflight({
      PRODUCTION_CONTENT_INGEST_ENABLED: 'true',
      PRODUCTION_INPUTS_VALIDATED: 'true',
    });
    const validated = preflight({
      PRODUCTION_CONTENT_INGEST_ENABLED: 'true',
      PRODUCTION_INPUTS_VALIDATED: 'true',
      PRODUCTION_LP_MAPPING_VALIDATED: 'true',
    });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('PRODUCTION_INPUTS_VALIDATED must be true');
    expect(inputsOnly.status).toBe(1);
    expect(inputsOnly.stderr).toContain('PRODUCTION_LP_MAPPING_VALIDATED must be true');
    expect(validated.status).toBe(0);
  });

  it('always requires the independent global publishing stop', () => {
    const result = preflight({ GLOBAL_PUBLISHING_DISABLED: 'false' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GLOBAL_PUBLISHING_DISABLED must be explicitly true');
  });

  it('allows an explicitly approved Phase 3 release only with exact allowlists and resumed environment', () => {
    const missingApproval = preflight({
      CUBELIC_PHASE3_ENABLED: 'true',
      GLOBAL_PUBLISHING_DISABLED: 'false',
    });
    expect(missingApproval.status).toBe(1);
    expect(missingApproval.stderr).toContain('PHASE3_RELEASE_APPROVED must be true');

    const approved = preflight({
      CUBELIC_PHASE3_ENABLED: 'true',
      CUBELIC_PHASE3_DELIVERY_MODE: 'x',
      GLOBAL_PUBLISHING_DISABLED: 'false',
      PHASE3_RELEASE_APPROVED: 'true',
      STAGING_PHASE3_SMOKE_VERIFIED: 'true',
      CUBELIC_PHASE3_SCHEDULE_POLICIES: 'event_notice:event_notice_manual_v1',
    });
    expect(approved.status).toBe(0);
    expect(approved.stdout).toContain('Phase 3 publication capability');

    const mismatchedDeployment = preflight({
      CUBELIC_PHASE3_ENABLED: 'true',
      CUBELIC_PHASE3_DELIVERY_MODE: 'x',
      GLOBAL_PUBLISHING_DISABLED: 'false',
      PHASE3_RELEASE_APPROVED: 'true',
      STAGING_PHASE3_SMOKE_VERIFIED: 'true',
      CUBELIC_PHASE3_SCHEDULE_POLICIES: 'youtube_notice:youtube_notice_manual_v1',
    });
    expect(mismatchedDeployment.status).toBe(1);
    expect(mismatchedDeployment.stderr).toContain(
      'wrangler production CUBELIC_PHASE3_SCHEDULE_POLICIES does not match',
    );

    const fakeProduction = preflight({
      CUBELIC_PHASE3_ENABLED: 'true',
      CUBELIC_PHASE3_DELIVERY_MODE: 'staging_fake',
      GLOBAL_PUBLISHING_DISABLED: 'false',
      PHASE3_RELEASE_APPROVED: 'true',
      STAGING_PHASE3_SMOKE_VERIFIED: 'true',
      CUBELIC_PHASE3_SCHEDULE_POLICIES: 'event_notice:event_notice_v1',
    });
    expect(fakeProduction.status).toBe(1);
    expect(fakeProduction.stderr).toContain('CUBELIC_PHASE3_DELIVERY_MODE must be x');
  });

  it('rejects the staging fake delivery mode in every production phase', () => {
    const result = preflight({ CUBELIC_PHASE3_DELIVERY_MODE: 'staging_fake' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CUBELIC_PHASE3_DELIVERY_MODE must be x');
  });

  it('requires either verified Wrangler auth or a least-privilege API token', () => {
    const missing = preflight({ CLOUDFLARE_AUTH_VERIFIED: 'false' });
    const token = preflight({
      CLOUDFLARE_AUTH_VERIFIED: 'false',
      CLOUDFLARE_API_TOKEN: 'c'.repeat(32),
    });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('set a least-privilege CLOUDFLARE_API_TOKEN or set CLOUDFLARE_AUTH_VERIFIED=true');
    expect(token.status).toBe(0);
  });
});
