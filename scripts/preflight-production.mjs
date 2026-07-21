import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredSecrets = ['API_KEY', 'HUMAN_APPROVAL_KEY', 'HERMES_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN'];
const errors = [];

for (const name of requiredSecrets) {
  if (!process.env[name]) errors.push(`missing secret environment variable: ${name}`);
  else if (process.env[name].length < 32) errors.push(`${name} is shorter than the 32-character production minimum`);
}
const authorizationSecrets = ['API_KEY', 'HUMAN_APPROVAL_KEY', 'HERMES_ACCESS_TOKEN'].map((name) => process.env[name]).filter(Boolean);
if (new Set(authorizationSecrets).size !== authorizationSecrets.length) errors.push('API, Hermes, and human approval secrets must be distinct');
if (!process.env.X_HARNESS_ACCOUNT_ID || process.env.X_HARNESS_ACCOUNT_ID === 'SET_AFTER_ACCOUNT_SETUP') {
  errors.push('missing production X_HARNESS_ACCOUNT_ID mapping');
}
if (process.env.CUBELIC_SAFE_MODE !== 'true') errors.push('CUBELIC_SAFE_MODE must be explicitly true');
if (process.env.PRODUCTION_INPUTS_VALIDATED !== 'true') errors.push('PRODUCTION_INPUTS_VALIDATED must be true after validate:production-inputs succeeds');
if (process.env.STAGING_SMOKE_VERIFIED !== 'true') errors.push('STAGING_SMOKE_VERIFIED must be true after smoke:staging succeeds');
const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length === 0) errors.push('CORS_ALLOWED_ORIGINS must contain at least one production UI origin');
if (corsOrigins.some((origin) => origin === '*' || !origin.startsWith('https://') || /localhost|127\.0\.0\.1/.test(origin))) {
  errors.push('production CORS origins must be exact HTTPS origins without wildcard or localhost');
}

const wrangler = await readFile(join(root, 'apps/worker/wrangler.toml'), 'utf8');
if (/YOUR_D1_DATABASE_ID/.test(wrangler)) errors.push('wrangler.toml still contains the D1 database-id placeholder');
if (/your-subdomain\.workers\.dev/.test(wrangler)) errors.push('wrangler.toml still contains the Worker URL placeholder');
if (/X_HARNESS_ACCOUNT_ID\s*=\s*"SET_AFTER_ACCOUNT_SETUP"/.test(wrangler)) errors.push('wrangler.toml still contains the X account placeholder');
if (/CORS_ALLOWED_ORIGINS\s*=\s*"http:\/\/localhost/.test(wrangler)) errors.push('wrangler.toml still contains the local CORS origin');
if (!/^CUBELIC_SAFE_MODE\s*=\s*"true"$/m.test(wrangler)) errors.push('wrangler.toml does not default CUBELIC_SAFE_MODE to true');

if (errors.length) {
  console.error(`Production preflight is blocked (${errors.length}):\n- ${errors.join('\n- ')}`);
  console.error('No secret values were printed. Resolve the named inputs, then rerun pnpm preflight:production.');
  process.exitCode = 1;
} else {
  console.log('Production preflight passed. Run the staging checklist before any production deployment.');
}
