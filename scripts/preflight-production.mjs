import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];
const hermesRuntimeEnabled = process.env.HERMES_RUNTIME_ENABLED === 'true';
const productionContentIngestEnabled = process.env.PRODUCTION_CONTENT_INGEST_ENABLED === 'true';
const cloudflareAuthVerified = process.env.CLOUDFLARE_AUTH_VERIFIED === 'true';
const phase3Enabled = process.env.CUBELIC_PHASE3_ENABLED === 'true';
const requiredSecrets = ['API_KEY', 'HUMAN_APPROVAL_KEY'];
if (hermesRuntimeEnabled) requiredSecrets.push('HERMES_ACCESS_TOKEN');

for (const name of ['HERMES_RUNTIME_ENABLED', 'PRODUCTION_CONTENT_INGEST_ENABLED', 'PRODUCTION_INPUTS_VALIDATED', 'PRODUCTION_LP_MAPPING_VALIDATED', 'CLOUDFLARE_AUTH_VERIFIED', 'CUBELIC_PHASE3_ENABLED', 'PHASE3_RELEASE_APPROVED', 'STAGING_PHASE3_SMOKE_VERIFIED']) {
  if (process.env[name] && !['true', 'false'].includes(process.env[name])) {
    errors.push(`${name} must be true or false when set`);
  }
}

for (const name of requiredSecrets) {
  if (!process.env[name]) errors.push(`missing secret environment variable: ${name}`);
  else if (process.env[name].length < 32) errors.push(`${name} is shorter than the 32-character production minimum`);
}
if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length < 32) {
  errors.push('CLOUDFLARE_API_TOKEN is shorter than the 32-character production minimum');
}
if (!process.env.CLOUDFLARE_API_TOKEN && !cloudflareAuthVerified) {
  errors.push('set a least-privilege CLOUDFLARE_API_TOKEN or set CLOUDFLARE_AUTH_VERIFIED=true after wrangler whoami succeeds');
}
const authorizationSecretNames = ['API_KEY', 'HUMAN_APPROVAL_KEY'];
if (hermesRuntimeEnabled) authorizationSecretNames.push('HERMES_ACCESS_TOKEN');
const authorizationSecrets = authorizationSecretNames.map((name) => process.env[name]).filter(Boolean);
if (new Set(authorizationSecrets).size !== authorizationSecrets.length) {
  errors.push(`${authorizationSecretNames.join(', ')} must be distinct`);
}
if (!process.env.X_HARNESS_ACCOUNT_ID || process.env.X_HARNESS_ACCOUNT_ID === 'SET_AFTER_ACCOUNT_SETUP') {
  errors.push('missing production X_HARNESS_ACCOUNT_ID mapping');
}
if (process.env.CUBELIC_SAFE_MODE !== 'true') errors.push('CUBELIC_SAFE_MODE must be explicitly true');
if (phase3Enabled) {
  if (process.env.GLOBAL_PUBLISHING_DISABLED !== 'false') {
    errors.push('GLOBAL_PUBLISHING_DISABLED must be explicitly false for an approved Phase 3 release');
  }
  if (process.env.PHASE3_RELEASE_APPROVED !== 'true') {
    errors.push('PHASE3_RELEASE_APPROVED must be true for a Phase 3 publication release');
  }
  if (process.env.STAGING_PHASE3_SMOKE_VERIFIED !== 'true') {
    errors.push('STAGING_PHASE3_SMOKE_VERIFIED must be true after Phase 3 staging smoke succeeds');
  }
  const allowedCategories = new Set(['event_notice', 'event_reminder', 'youtube_notice']);
  const policies = (process.env.CUBELIC_PHASE3_SCHEDULE_POLICIES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (policies.length === 0 || policies.some((policy) => {
    const [category, templateId, ...rest] = policy.split(':');
    return rest.length > 0
      || !allowedCategories.has(category)
      || !/^[a-z0-9][a-z0-9_-]{2,80}$/.test(templateId ?? '');
  })) {
    errors.push('CUBELIC_PHASE3_SCHEDULE_POLICIES must contain reviewed category:template_id pairs');
  }
} else if (process.env.GLOBAL_PUBLISHING_DISABLED !== 'true') {
  errors.push('GLOBAL_PUBLISHING_DISABLED must be explicitly true');
}
if (productionContentIngestEnabled && process.env.PRODUCTION_INPUTS_VALIDATED !== 'true') {
  errors.push('PRODUCTION_INPUTS_VALIDATED must be true before production content ingestion is enabled');
}
if (productionContentIngestEnabled && process.env.PRODUCTION_LP_MAPPING_VALIDATED !== 'true') {
  errors.push('PRODUCTION_LP_MAPPING_VALIDATED must be true before production content ingestion is enabled');
}
if (process.env.STAGING_SMOKE_VERIFIED !== 'true') errors.push('STAGING_SMOKE_VERIFIED must be true after smoke:staging succeeds');
const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length === 0) errors.push('CORS_ALLOWED_ORIGINS must contain at least one production UI origin');
if (corsOrigins.some((origin) => origin === '*' || !origin.startsWith('https://') || /localhost|127\.0\.0\.1/.test(origin))) {
  errors.push('production CORS origins must be exact HTTPS origins without wildcard or localhost');
}
if (!corsOrigins.includes('https://ops.cubelic-fan.com')) {
  errors.push('CORS_ALLOWED_ORIGINS must include the approved production operator UI origin: https://ops.cubelic-fan.com');
}
if (corsOrigins.includes('https://cubelic-fan.com')) {
  errors.push('the public fan-site origin must not be authorized as the production operator UI');
}

const wrangler = await readFile(join(root, 'apps/worker/wrangler.toml'), 'utf8');
if (/YOUR_D1_DATABASE_ID/.test(wrangler)) errors.push('wrangler.toml still contains the D1 database-id placeholder');
if (/your-subdomain\.workers\.dev/.test(wrangler)) errors.push('wrangler.toml still contains the Worker URL placeholder');
if (/X_HARNESS_ACCOUNT_ID\s*=\s*"SET_AFTER_ACCOUNT_SETUP"/.test(wrangler)) errors.push('wrangler.toml still contains the X account placeholder');
if (/CORS_ALLOWED_ORIGINS\s*=\s*"http:\/\/localhost/.test(wrangler)) errors.push('wrangler.toml still contains the local CORS origin');
if (!/CORS_ALLOWED_ORIGINS\s*=\s*"https:\/\/ops\.cubelic-fan\.com"/.test(wrangler)) {
  errors.push('wrangler.toml does not bind production CORS to the approved operator UI origin');
}
if (!/^CUBELIC_SAFE_MODE\s*=\s*"true"$/m.test(wrangler)) errors.push('wrangler.toml does not default CUBELIC_SAFE_MODE to true');
if (!/^CUBELIC_PHASE3_ENABLED\s*=\s*"false"$/m.test(wrangler)) errors.push('wrangler.toml does not default CUBELIC_PHASE3_ENABLED to false');
if (!/^PHASE3_RELEASE_APPROVED\s*=\s*"false"$/m.test(wrangler)) errors.push('wrangler.toml does not default PHASE3_RELEASE_APPROVED to false');
if (!/^STAGING_PHASE3_SMOKE_VERIFIED\s*=\s*"false"$/m.test(wrangler)) errors.push('wrangler.toml does not default STAGING_PHASE3_SMOKE_VERIFIED to false');
if (!/^GLOBAL_PUBLISHING_DISABLED\s*=\s*"true"$/m.test(wrangler)) errors.push('wrangler.toml does not default GLOBAL_PUBLISHING_DISABLED to true');

if (errors.length) {
  console.error(`Production preflight is blocked (${errors.length}):\n- ${errors.join('\n- ')}`);
  console.error('No secret values were printed. Resolve the named inputs, then rerun pnpm preflight:production.');
  process.exitCode = 1;
} else {
  console.log(phase3Enabled
    ? 'Production preflight passed for the approved Phase 3 publication capability. Run the Phase 3 staging checklist before deployment.'
    : 'Production preflight passed for the Phase 1 runtime. Run the staging checklist before any production deployment.');
}
