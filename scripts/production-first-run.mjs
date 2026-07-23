import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inputNames = [
  'LP_EVENT_PATH',
  'LP_MAPPING_APPROVAL_PATH',
  'GAS_PAYLOAD_PATH',
  'RESOLVE_METADATA_PATH',
  'SONG_MASTER_PATH',
  'MEMBER_MASTER_PATH',
];

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readInputs(environment) {
  const values = {};
  for (const name of inputNames) {
    try {
      values[name] = JSON.parse(await readFile(required(environment, name), 'utf8'));
    } catch {
      throw new Error(`${name} could not be read as JSON`);
    }
  }
  return values;
}

function runInputValidator(environment) {
  const result = spawnSync(process.execPath, [
    join(root, 'packages/schemas/src/validate-production-inputs.mjs'),
  ], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Production input validation failed; run pnpm validate:production-inputs for field-level diagnostics');
}

async function request(fetchImpl, baseUrl, apiKey, path, options = {}) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.humanKey ? { 'X-Human-Approval-Key': options.humanKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const code = typeof payload?.code === 'string' ? ` (${payload.code})` : '';
    throw new Error(`${options.label ?? path} failed with HTTP ${response.status}${code}`);
  }
  return payload.data;
}

function assertSafeStatus(status) {
  if (status?.safeMode !== true) throw new Error('CUBΣLIC safe mode is not active');
  if (status?.emergencyStopValid !== true) {
    throw new Error('The D1 emergency-stop state is missing or invalid');
  }
  if (status?.publishingEnabled !== false || status?.schedulingEnabled !== false) {
    throw new Error('Publishing or scheduling capability is unexpectedly enabled');
  }
}

function assertOperationAuthorization(environment, eventId, execute) {
  const inputsAttested = environment.PRODUCTION_INPUTS_VALIDATED === 'true';
  const lpMappingAttested = environment.PRODUCTION_LP_MAPPING_VALIDATED === 'true';
  if (!inputsAttested || !lpMappingAttested) {
    throw new Error('Both production input and LP mapping attestations must be true');
  }
  if (execute && environment.PRODUCTION_OPERATION_CONFIRMED !== eventId) {
    throw new Error('PRODUCTION_OPERATION_CONFIRMED must exactly match the validated event_id');
  }
  if (execute && environment.PRODUCTION_OPERATION_WINDOW_OPEN !== 'true') {
    throw new Error('PRODUCTION_OPERATION_WINDOW_OPEN must be explicitly true');
  }
}

export async function runProductionFirstRun({
  environment = process.env,
  fetchImpl = fetch,
  execute = false,
  validateInputs = runInputValidator,
  log = console.log,
} = {}) {
  validateInputs(environment);
  const inputs = await readInputs(environment);
  const eventId = inputs.LP_EVENT_PATH.event_id;
  const approvedLpMapping = inputs.LP_MAPPING_APPROVAL_PATH;
  if (!eventId || eventId !== inputs.GAS_PAYLOAD_PATH.event_id || eventId !== inputs.RESOLVE_METADATA_PATH.event_id) {
    throw new Error('Validated production inputs no longer agree on event_id');
  }
  if (
    approvedLpMapping.event_id !== eventId
    || approvedLpMapping.lp_url !== inputs.GAS_PAYLOAD_PATH.lp_url
    || approvedLpMapping.lp_update_confirmed !== true
  ) {
    throw new Error('LP mapping approval does not match the current event and destination');
  }
  assertOperationAuthorization(environment, eventId, execute);

  const baseUrl = new URL(required(environment, 'PRODUCTION_WORKER_URL'));
  if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('PRODUCTION_WORKER_URL must be an exact HTTPS origin');
  }
  const workerOrigin = baseUrl.origin;
  const apiKey = required(environment, 'PRODUCTION_API_KEY');
  const humanKey = required(environment, 'PRODUCTION_HUMAN_APPROVAL_KEY');
  const initialStatus = await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/status', { label: 'status check' });
  assertSafeStatus(initialStatus);

  if (!execute) {
    if (initialStatus.environmentStop !== true || initialStatus.emergencyStop !== true) {
      throw new Error('Readiness check requires both emergency stops to be active');
    }
    log('Production safety boundary verified.');
    log('Production first-run readiness check passed; no mutations were made.');
    return { executed: false };
  }
  if (initialStatus.environmentStop !== false) {
    throw new Error('The reviewed production operation window is not open');
  }
  log('Controlled production operation window verified; X publish and schedule capabilities remain disabled.');

  let serverWindowOpened = false;
  try {
    await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/operation-window', {
      method: 'POST',
      body: { eventId, durationMinutes: 30 },
      humanKey,
      label: 'operation window open',
    });
    serverWindowOpened = true;
    log('A server-enforced 30-minute event operation window was opened.');

    if (initialStatus.emergencyStop) {
      await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/emergency-resume', {
        method: 'POST',
        body: {},
        humanKey,
        label: 'draft operation resume',
      });
      log('Database draft operations resumed inside the controlled operation window.');
    }

    const operations = [
      ['song master', '/api/cubelic/masters/songs/ingest', inputs.SONG_MASTER_PATH],
      ['member master', '/api/cubelic/masters/members/ingest', inputs.MEMBER_MASTER_PATH],
      ['event', '/api/cubelic/events', inputs.LP_EVENT_PATH],
      ['Resolve metadata', '/api/cubelic/media/validate', inputs.RESOLVE_METADATA_PATH],
      ['GAS setlist', '/api/cubelic/setlists/ingest', inputs.GAS_PAYLOAD_PATH],
    ];
    for (const [label, path, body] of operations) {
      await request(fetchImpl, workerOrigin, apiKey, path, {
        method: 'POST',
        body,
        humanKey,
        label,
      });
      log(`${label} accepted.`);
    }

    const finalStatus = await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/status', { label: 'final status check' });
    assertSafeStatus(finalStatus);
    if (
      finalStatus.environmentStop !== false
      || finalStatus.operationWindow?.active !== true
      || finalStatus.operationWindow?.eventId !== eventId
    ) {
      throw new Error('The event-bound operation window changed unexpectedly during ingestion');
    }
    log('First-run ingestion completed. Review one draft and perform the inert handoff within 30 minutes; the server closes the D1 operation window after handoff. No X action was performed.');
    return { executed: true };
  } catch (error) {
    if (serverWindowOpened) {
      let closureFailed = false;
      try {
        await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/emergency-stop', {
          method: 'POST',
          body: {},
          humanKey,
          label: 'failure emergency stop',
        });
      } catch {
        closureFailed = true;
      }
      try {
        const closureStatus = await request(fetchImpl, workerOrigin, apiKey, '/api/cubelic/admin/status', { label: 'failure closure verification' });
        if (
          closureStatus.emergencyStopValid !== true
          || closureStatus.emergencyStop !== true
          || closureStatus.operationWindow?.active === true
        ) closureFailed = true;
      } catch {
        closureFailed = true;
      }
      if (closureFailed) {
        throw new Error('Production ingestion failed and the D1 operation window closure could not be verified; restore both emergency stops immediately');
      }
    }
    throw error;
  }
}

const invokedAsCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) {
  const execute = process.argv.includes('--execute');
  runProductionFirstRun({ execute }).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Production first-run failed');
    process.exitCode = 1;
  });
}
