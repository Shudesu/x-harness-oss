import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      if (pattern.test(source)) violations.push(`${relative(root, file)}: ${label}`);
    }
  }
}

const adapter = await readFile(join(root, 'packages/content-os/src/adapter.ts'), 'utf8');
for (const operation of ['schedulePost', 'publishPost', 'deletePost']) {
  const failClosed = new RegExp(`async ${operation}\\(\\): Promise<never>[\\s\\S]*?Phase1OperationDisabledError\\('${operation}'\\)`);
  if (!failClosed.test(adapter)) violations.push(`packages/content-os/src/adapter.ts: ${operation} is not fail-closed`);
}

const wrangler = await readFile(join(root, 'apps/worker/wrangler.toml'), 'utf8');
if (!/^CUBELIC_SAFE_MODE\s*=\s*"true"$/m.test(wrangler)) {
  violations.push('apps/worker/wrangler.toml: CUBELIC_SAFE_MODE must default to true');
}

const worker = await readFile(join(root, 'apps/worker/src/index.ts'), 'utf8');
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

const sidebar = await readFile(join(root, 'apps/web/src/components/layout/sidebar.tsx'), 'utf8');
if (!/const menuSections\s*=\s*safeMenuSections/.test(sidebar)) {
  violations.push('apps/web/src/components/layout/sidebar.tsx: Phase 1 navigation must use the safe allowlist unconditionally');
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
  console.log('Phase 1 boundary check passed. No direct X publishing surface is reachable from CUBΣLIC code.');
}
