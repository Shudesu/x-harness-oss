import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProductionFirstRun } from './production-first-run.mjs';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withInputFiles<T>(callback: (environment: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(resolve(tmpdir(), 'cubelic-first-run-'));
  const inputs = {
    LP_EVENT_PATH: {
      event_id: 'evt_production_first_run',
      title: 'Production Event',
      venue: 'Production Venue',
      starts_at: '2026-07-23T18:00:00+09:00',
      ends_at: '2026-07-23T19:00:00+09:00',
      state: 'ended',
      official_url: 'https://example.com/events/production',
      ticket_url: null,
      event_tags: [],
      filming_policy: {
        confirmed: false,
        scope: 'unknown',
        evidence_type: null,
        evidence_url: null,
        confirmed_at: null,
        confirmed_by: null,
        notes: null,
      },
    },
    LP_MAPPING_APPROVAL_PATH: {
      schema_version: 'cubelic.lp-mapping-approval.v1',
      event_id: 'evt_production_first_run',
      lp_url: 'https://cubelic-fan.com/setlists/evt_production_first_run',
      lp_update_confirmed: true,
      authority_source: 'approved operator source',
      confirmed_at: '2026-07-23T19:05:00+09:00',
      confirmed_by: 'Production Operator',
    },
    GAS_PAYLOAD_PATH: {
      event_id: 'evt_production_first_run',
      lp_url: 'https://cubelic-fan.com/setlists/evt_production_first_run',
    },
    RESOLVE_METADATA_PATH: { event_id: 'evt_production_first_run' },
    SONG_MASTER_PATH: { schema_version: 'cubelic.song-master.v1', songs: [] },
    MEMBER_MASTER_PATH: { schema_version: 'cubelic.member-master.v1', members: [] },
  };
  const environment: NodeJS.ProcessEnv = {
    PRODUCTION_WORKER_URL: 'https://worker.example.test',
    PRODUCTION_API_KEY: 'api-secret-must-not-leak',
    PRODUCTION_HUMAN_APPROVAL_KEY: 'human-secret-must-not-leak',
    PRODUCTION_INPUTS_VALIDATED: 'true',
    PRODUCTION_LP_MAPPING_VALIDATED: 'true',
    PRODUCTION_OPERATION_CONFIRMED: 'evt_production_first_run',
    PRODUCTION_OPERATION_WINDOW_OPEN: 'true',
  };
  for (const [name, value] of Object.entries(inputs)) {
    const path = resolve(directory, `${name}.json`);
    writeFileSync(path, JSON.stringify(value));
    environment[name] = path;
  }
  return callback(environment).finally(() => rmSync(directory, { recursive: true, force: true }));
}

describe('production first-run operation', () => {
  it('checks readiness without mutating production', async () => {
    await withInputFiles(async (environment) => {
      const calls: Array<{ url: string; method: string }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        return response(200, {
          success: true,
          data: {
            safeMode: true,
            environmentStop: true,
            emergencyStop: true,
            publishingEnabled: false,
            schedulingEnabled: false,
          },
        });
      };

      await runProductionFirstRun({
        environment,
        fetchImpl,
        execute: false,
        validateInputs: () => undefined,
        log: () => undefined,
      });

      expect(calls).toEqual([{
        url: 'https://worker.example.test/api/cubelic/admin/status',
        method: 'GET',
      }]);
    });
  });

  it('resumes draft operations and ingests approved inputs in dependency order', async () => {
    await withInputFiles(async (environment) => {
      const calls: Array<{ path: string; method: string; approval: string | null; authorization: string | null }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({
          path: url.pathname,
          method: init?.method ?? 'GET',
          approval: headers.get('X-Human-Approval-Key'),
          authorization: headers.get('Authorization'),
        });
        if (url.pathname.endsWith('/admin/status')) {
          return response(200, {
            success: true,
            data: {
              safeMode: true,
              environmentStop: false,
              emergencyStop: calls.length === 1,
              operationWindow: calls.length === 1 ? null : {
                eventId: 'evt_production_first_run',
                expiresAt: '2026-07-23T20:00:00+09:00',
                active: true,
              },
              publishingEnabled: false,
              schedulingEnabled: false,
            },
          });
        }
        return response(201, { success: true, data: {} });
      };
      const logs: string[] = [];

      await runProductionFirstRun({
        environment,
        fetchImpl,
        execute: true,
        validateInputs: () => undefined,
        log: (message) => logs.push(message),
      });

      expect(calls.map(({ path }) => path)).toEqual([
        '/api/cubelic/admin/status',
        '/api/cubelic/admin/operation-window',
        '/api/cubelic/admin/emergency-resume',
        '/api/cubelic/masters/songs/ingest',
        '/api/cubelic/masters/members/ingest',
        '/api/cubelic/events',
        '/api/cubelic/media/validate',
        '/api/cubelic/setlists/ingest',
        '/api/cubelic/admin/status',
      ]);
      expect(calls.slice(1, 8).every(({ approval }) => approval === environment.PRODUCTION_HUMAN_APPROVAL_KEY)).toBe(true);
      expect(calls.every(({ authorization }) => authorization === `Bearer ${environment.PRODUCTION_API_KEY}`)).toBe(true);
      expect(logs.join('\n')).not.toContain(environment.PRODUCTION_API_KEY);
      expect(logs.join('\n')).not.toContain(environment.PRODUCTION_HUMAN_APPROVAL_KEY);
      expect(logs.join('\n')).not.toContain(environment.PRODUCTION_OPERATION_CONFIRMED);
    });
  });

  it('fails closed unless the event-specific confirmation and closed readiness state are present', async () => {
    await withInputFiles(async (environment) => {
      environment.PRODUCTION_OPERATION_CONFIRMED = 'wrong-event';
      await expect(runProductionFirstRun({
        environment,
        execute: true,
        validateInputs: () => undefined,
        log: () => undefined,
      })).rejects.toThrow('PRODUCTION_OPERATION_CONFIRMED');

      environment.PRODUCTION_OPERATION_CONFIRMED = 'evt_production_first_run';
      await expect(runProductionFirstRun({
        environment,
        execute: false,
        validateInputs: () => undefined,
        log: () => undefined,
        fetchImpl: async () => response(200, {
          success: true,
          data: {
            safeMode: true,
            environmentStop: false,
            emergencyStop: true,
            publishingEnabled: false,
            schedulingEnabled: false,
          },
        }),
      })).rejects.toThrow('both emergency stops');
    });
  });

  it('rejects an LP approval that is stale for the current destination', async () => {
    await withInputFiles(async (environment) => {
      const path = environment.LP_MAPPING_APPROVAL_PATH!;
      const approval = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8')));
      approval.lp_url = 'https://cubelic-fan.com/setlists/stale';
      writeFileSync(path, JSON.stringify(approval));

      await expect(runProductionFirstRun({
        environment,
        execute: false,
        validateInputs: () => undefined,
        log: () => undefined,
      })).rejects.toThrow('LP mapping approval');
    });
  });

  it('re-engages the D1 emergency stop when ingestion fails', async () => {
    await withInputFiles(async (environment) => {
      const paths: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path.endsWith('/admin/status')) {
          return response(200, {
            success: true,
            data: {
              safeMode: true,
              environmentStop: false,
              emergencyStop: true,
              publishingEnabled: false,
              schedulingEnabled: false,
            },
          });
        }
        if (path.endsWith('/masters/members/ingest')) return response(422, { success: false, code: 'invalid_request' });
        return response(201, { success: true, data: {} });
      };

      await expect(runProductionFirstRun({
        environment,
        fetchImpl,
        execute: true,
        validateInputs: () => undefined,
        log: () => undefined,
      })).rejects.toThrow('member master failed');
      expect(paths.slice(-2)).toEqual([
        '/api/cubelic/admin/emergency-stop',
        '/api/cubelic/admin/status',
      ]);
    });
  });
});
