import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWranglerBoundaries } from './lib/check-wrangler-boundaries.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const codeRoots = [
  'packages/content-os/src',
  'apps/worker/src/cubelic',
  'apps/worker/src/routes/cubelic.ts',
  'apps/web/src/app/cubelic',
  'packages/mcp/src/tools/cubelic.ts',
];
const forbidden = [
  ['X SDK import', /@x-harness\/x-sdk/],
  ['direct X client', /\bXClient\b/],
  ['legacy post endpoint call', /\b(?:fetch|apiRequest)\s*(?:<[^>]+>)?\(\s*['"`]\/api\/posts(?:\/schedule)?\b/],
  ['browser scraping', /twitter-cli|document\.cookie|playwright/i],
];

async function filesAt(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return [path];
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesAt(child));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(child);
  }
  return files;
}

const violations = [];
for (const configuredPath of codeRoots) {
  for (const file of await filesAt(join(root, configuredPath))) {
    const source = await readFile(file, 'utf8');
    for (const [label, pattern] of forbidden) {
      const adapterInfrastructure = relative(root, file) === 'apps/worker/src/cubelic/adapter.ts';
      if (adapterInfrastructure && ['X SDK import', 'direct X client'].includes(label)) continue;
      if (pattern.test(source)) violations.push(`${relative(root, file)}: ${label}`);
    }
  }
}

const adapter = await readFile(join(root, 'packages/content-os/src/adapter.ts'), 'utf8');
for (const operation of ['schedulePost', 'publishPost', 'deletePost']) {
  const failClosed = new RegExp(`class Phase1XPublishingAdapter[\\s\\S]*?async ${operation}\\([^)]*\\): Promise<never>[\\s\\S]*?Phase1OperationDisabledError\\('${operation}'\\)`);
  if (!failClosed.test(adapter)) violations.push(`packages/content-os/src/adapter.ts: ${operation} is not fail-closed`);
}

const wrangler = await readFile(join(root, 'apps/worker/wrangler.toml'), 'utf8');
violations.push(...validateWranglerBoundaries(wrangler));

const worker = await readFile(join(root, 'apps/worker/src/index.ts'), 'utf8');
const routeGuardIndex = worker.indexOf("app.use('*', cubelicPhase1RouteGuard)");
const authIndex = worker.indexOf("app.use('*', authMiddleware)");
if (routeGuardIndex < 0 || authIndex < 0 || routeGuardIndex > authIndex) {
  violations.push('apps/worker/src/index.ts: Phase 1 route guard must run before authentication and route handlers');
}
for (const forbiddenCronCall of ['processScheduledPosts', 'processEngagementGates', 'processStepSequences']) {
  if (worker.includes(forbiddenCronCall)) {
    violations.push(`apps/worker/src/index.ts: Phase 1 Cron must not reference ${forbiddenCronCall}`);
  }
}
for (const forbiddenXReference of ['@x-harness/x-sdk', 'XClient', 'getXAccounts', 'recordSnapshot']) {
  if (worker.includes(forbiddenXReference)) {
    violations.push(`apps/worker/src/index.ts: Phase 1 Worker entrypoint must not reference ${forbiddenXReference}`);
  }
}

const capabilities = await readFile(join(root, 'apps/worker/src/routes/capabilities.ts'), 'utf8');
if (!/const safeMode\s*=\s*true/.test(capabilities) || !/const publishingDisabled\s*=\s*true/.test(capabilities)) {
  violations.push('apps/worker/src/routes/capabilities.ts: Phase 1 capabilities must be compile-time draft-only');
}

const safety = await readFile(join(root, 'apps/worker/src/cubelic/safety.ts'), 'utf8');
for (const requiredBlockedSurface of ['/api/users', '/api/engagement-gates', '/api/settings']) {
  if (safety.includes(`'GET ${requiredBlockedSurface}`)) {
    violations.push(`apps/worker/src/cubelic/safety.ts: legacy surface ${requiredBlockedSurface} must not be allowlisted`);
  }
}

const sidebar = await readFile(join(root, 'apps/web/src/components/layout/sidebar.tsx'), 'utf8');
if (!/const menuSections\s*=\s*safeMenuSections/.test(sidebar)) {
  violations.push('apps/web/src/components/layout/sidebar.tsx: Phase 1 navigation must use the safe allowlist unconditionally');
}
const authGuard = await readFile(join(root, 'apps/web/src/components/auth-guard.tsx'), 'utf8');
if (!/pathname !== ['"]\/cubelic['"]/.test(authGuard) || !/router\.replace\(['"]\/cubelic['"]\)/.test(authGuard)) {
  violations.push('apps/web/src/components/auth-guard.tsx: authenticated Phase 1 UI must redirect legacy pages to /cubelic');
}

const mcp = await readFile(join(root, 'packages/mcp/src/index.ts'), 'utf8');
if (!/tools:\s*cubelicToolDefs/.test(mcp)
  || !/if \(!toolNames\.has\(name\)\)/.test(mcp)) {
  violations.push('packages/mcp/src/index.ts: MCP must unconditionally expose only the CUBΣLIC allowlist');
}
for (const forbiddenLegacyTool of ['postToolDefs', 'engagementToolDefs', 'dmToolDefs', 'scrapeToolDefs', "case 'create_post'", "case 'send_dm'"]) {
  if (mcp.includes(forbiddenLegacyTool)) violations.push(`packages/mcp/src/index.ts: Phase 1 MCP must not compile ${forbiddenLegacyTool}`);
}

const strategy = await readFile(join(root, 'config/strategy.yaml'), 'utf8');
for (const setting of ['publish_now_enabled', 'auto_schedule_enabled', 'auto_dm_enabled', 'auto_reply_enabled', 'auto_like_enabled', 'auto_follow_enabled']) {
  if (!new RegExp(`^\\s*${setting}: false$`, 'm').test(strategy)) {
    violations.push(`config/strategy.yaml: ${setting} must be false in Phase 1`);
  }
}

if (violations.length) {
  console.error(`Phase 1 boundary check failed:\n- ${violations.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('CUBΣLIC boundary check passed. Phase 1 remains inert and each enabled Phase 3 environment has explicit release gates.');
}
