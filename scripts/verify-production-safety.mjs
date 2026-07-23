import { evaluateProductionSafety } from './lib/verify-production-safety.mjs';

const baseUrl = process.env.PRODUCTION_WORKER_URL?.replace(/\/$/, '');
const apiKey = process.env.PRODUCTION_API_KEY;

if (!baseUrl || !apiKey) {
  console.error('Set PRODUCTION_WORKER_URL and PRODUCTION_API_KEY through the approved secret channel.');
  process.exit(2);
}
const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== 'https:') {
  console.error('PRODUCTION_WORKER_URL must use HTTPS.');
  process.exit(2);
}

let response;
try {
  response = await fetch(`${baseUrl}/api/cubelic/admin/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
} catch {
  console.error('Production safety verification could not reach the Worker.');
  process.exit(1);
}
const body = await response.json().catch(() => null);
if (!response.ok || body?.success !== true) {
  console.error(`Production safety verification failed to read status (HTTP ${response.status}).`);
  process.exit(1);
}
const failures = evaluateProductionSafety(body.data);
if (failures.length > 0) {
  console.error(`Production safety verification failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Production safety verified: exact D1 stop is active; publishing, scheduling, and operation window are closed.');
