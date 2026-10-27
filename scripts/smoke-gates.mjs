import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.local'), { recursive: true });
const scratch = mkdtempSync(join(root, '.local/gate-smoke-'));
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const args = ['--filter', 'worker', 'exec', 'wrangler'];
const localPath = join(scratch, 'state');
const secret = 'synthetic-workerd-test-integration-key-only';
let child;
const log = createWriteStream(join(root, '.local/gate-smoke-runtime.log'));
try {
  execFileSync(
    'pnpm',
    [...args, 'd1', 'migrations', 'apply', 'x-harness', '--local', '--persist-to', localPath],
    { cwd: root, env, stdio: 'pipe' },
  );
  const seed = join(scratch, 'seed.sql');
  writeFileSync(
    seed,
    `
 INSERT INTO x_accounts(id,x_user_id,username,access_token,created_at,updated_at) VALUES ('fixture-account','999','fixture','synthetic','2020','2020');
 INSERT INTO line_connections(id,name,worker_url,api_key,integration_secret,created_at) VALUES ('fixture-line','Fixture','https://line.example','synthetic','${secret}','2020');
 INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at,gate_mode,slug,title,ends_at,claim_phrase,brand_username,line_connection_id,gate_state,tracked_link_ref,tier) VALUES ('fixture-gate','fixture-account','555','reply','verify_only','','2026-10-27','2026-10-27','line_first','fixture','Synthetic campaign','2099-01-01T00:00:00Z','参加','fixture','fixture-line','active','fixture-ref','simple');
 INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('fixture-reward','fixture-gate',1,'Fixture','line_message','Synthetic reward',NULL);
 `,
  );
  execFileSync(
    'pnpm',
    [...args, 'd1', 'execute', 'x-harness', '--local', '--persist-to', localPath, '--file', seed],
    { cwd: root, env, stdio: 'pipe' },
  );
  const port = Number(process.env.GATE_SMOKE_PORT || 8807),
    base = `http://127.0.0.1:${port}`;
  child = spawn(
    'pnpm',
    [...args, 'dev', '--local', '--port', String(port), '--persist-to', localPath],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Local Worker did not start');
  const og = await fetch(base + '/c/fixture/og.png', { signal: AbortSignal.timeout(20000) });
  if (!og.ok) throw new Error(`OG failed: ${og.status}`);
  const png = Buffer.from(await og.arrayBuffer());
  if (
    png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    png.readUInt32BE(16) !== 1200 ||
    png.readUInt32BE(20) !== 630
  )
    throw new Error('Invalid PNG');
  writeFileSync(join(root, '.local/gate-og-runtime.png'), png);
  const path = '/api/integrations/line-harness/claims',
    body = JSON.stringify({ gateId: 'fixture-gate', lineFriendId: 'synthetic-friend' }),
    timestamp = String(Date.now()),
    deliveryId = randomUUID(),
    event = 'line.gate.claim';
  const canonical = [
    'xh.gate.v1',
    'POST',
    path,
    'fixture-line',
    event,
    deliveryId,
    timestamp,
    createHash('sha256').update(body).digest('hex'),
  ].join('\n');
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Harness-Connection-Id': 'fixture-line',
      'X-Harness-Event': event,
      'X-Harness-Delivery-Id': deliveryId,
      'X-Harness-Timestamp': timestamp,
      'X-Harness-Signature':
        'sha256=' + createHmac('sha256', secret).update(canonical).digest('hex'),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.data?.status !== 'rewarded' ||
    result.data?.reward?.value !== 'Synthetic reward'
  )
    throw new Error('Durable Object simple-claim smoke failed');
  console.log(
    'Local workerd: PNG 1200x630, signed claim, Durable Object and D1 reward transaction passed. No external messages sent.',
  );
} finally {
  if (child?.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
  log.end();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(scratch, { recursive: true, force: true });
}
