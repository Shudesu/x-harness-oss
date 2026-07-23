import { execFileSync } from 'node:child_process';

function keychainSecret(service) {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`Required macOS Keychain item is unavailable: ${service}`);
  }
}

process.env.PRODUCTION_WORKER_URL ??= 'https://x-harness-worker-production.yoshihiro-fukiya.workers.dev';
process.env.PRODUCTION_API_KEY = keychainSecret('CUBELIC Production Staff API Key');
await import('./verify-production-safety.mjs');
