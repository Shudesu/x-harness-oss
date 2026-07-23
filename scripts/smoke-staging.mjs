const baseUrl = process.env.STAGING_WORKER_URL?.replace(/\/$/, '');
const apiKey = process.env.STAGING_API_KEY;

if (!baseUrl || !apiKey) {
  console.error('Set STAGING_WORKER_URL and STAGING_API_KEY through the approved secret channel.');
  process.exit(2);
}
const parsedBaseUrl = new URL(baseUrl);
const localHttpAllowed = process.env.SMOKE_ALLOW_HTTP_LOCALHOST === 'true'
  && parsedBaseUrl.protocol === 'http:'
  && ['localhost', '127.0.0.1'].includes(parsedBaseUrl.hostname);
if (parsedBaseUrl.protocol !== 'https:' && !localHttpAllowed) {
  console.error('STAGING_WORKER_URL must use HTTPS.');
  process.exit(2);
}

const auth = { Authorization: `Bearer ${apiKey}` };

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...auth, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

const failures = [];

const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(15_000) });
if (!health.ok) failures.push(`/api/health returned ${health.status}`);

const capabilities = await json('/api/capabilities');
if (!capabilities.response.ok) {
  failures.push(`/api/capabilities returned ${capabilities.response.status}`);
} else {
  const safety = capabilities.body?.data?.safety;
  for (const key of ['immediatePublishing', 'scheduling', 'dm', 'automatedEngagement', 'cookieScraping']) {
    if (safety?.[key] !== false) failures.push(`capability safety.${key} must be false`);
  }
  if (safety?.cubelicSafeMode !== true) failures.push('capability safety.cubelicSafeMode must be true');
}

const status = await json('/api/cubelic/admin/status');
if (!status.response.ok) {
  failures.push(`/api/cubelic/admin/status returned ${status.response.status}`);
} else {
  if (status.body?.data?.emergencyStopValid !== true) {
    failures.push('CUBΣLIC emergency-stop state is missing or invalid');
  }
  if (status.body?.data?.publishingEnabled !== false || status.body?.data?.schedulingEnabled !== false) {
    failures.push('CUBΣLIC status exposed publishing or scheduling');
  }
}

const legacyWrite = await json('/api/posts', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
if (legacyWrite.response.status !== 423) failures.push(`legacy post write returned ${legacyWrite.response.status}, expected 423`);

const legacyRead = await json('/api/users/search?query=phase1-boundary');
if (legacyRead.response.status !== 423) failures.push(`legacy X-backed read returned ${legacyRead.response.status}, expected 423`);

const approvalProof = await json('/api/cubelic/x-harness-inbox/drf_smoke_missing');
if (approvalProof.response.status !== 403) failures.push(`human-only inbox read returned ${approvalProof.response.status} without approval proof, expected 403`);

if (failures.length > 0) {
  console.error(`Staging smoke failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Staging smoke passed: health, draft-only capabilities, legacy route lock, and human-proof boundary are active.');
