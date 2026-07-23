import { execFileSync } from 'node:child_process';
import { runProductionFirstRun } from './production-first-run.mjs';

function keychainSecret(service) {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', service], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`Required macOS Keychain item is unavailable: ${service}`);
  }
}

const environment = {
  ...process.env,
  PRODUCTION_WORKER_URL: process.env.PRODUCTION_WORKER_URL
    ?? 'https://x-harness-worker-production.yoshihiro-fukiya.workers.dev',
  PRODUCTION_API_KEY: keychainSecret('CUBELIC Production API Key'),
  PRODUCTION_HUMAN_APPROVAL_KEY: keychainSecret('CUBELIC Production Human Approval Key'),
};

runProductionFirstRun({
  environment,
  execute: process.argv.includes('--execute'),
}).catch((error) => {
  console.error(error instanceof Error ? error.message : 'Production first-run failed');
  process.exitCode = 1;
});
