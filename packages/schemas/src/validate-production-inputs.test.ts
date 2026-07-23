import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const validatorPath = resolve(repositoryRoot, 'packages/schemas/src/validate-production-inputs.mjs');
const fixturesRoot = resolve(repositoryRoot, 'packages/test-fixtures/contracts');
const denylist = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'packages/test-fixtures/production-input-denylist.json'),
  'utf8',
)) as {
  fixtureFiles: string[];
  testOnlyValues: Array<{ value: string; replacement: string }>;
};
const fixtureNames = {
  event: 'lp-event-v1.json',
  lpMappingApproval: 'lp-mapping-approval-v1.json',
  gas: 'gas-setlist-v1.json',
  resolve: 'resolve-metadata-v1.json',
  songMaster: 'song-master-v1.json',
  memberMaster: 'member-master-v1.json',
} as const;
type FixtureName = keyof typeof fixtureNames;

function inputEnvironment(inputDirectory: string, resolveRoot: string, allowedRoots: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    INIT_CWD: repositoryRoot,
    LP_EVENT_PATH: resolve(inputDirectory, fixtureNames.event),
    LP_MAPPING_APPROVAL_PATH: resolve(inputDirectory, fixtureNames.lpMappingApproval),
    GAS_PAYLOAD_PATH: resolve(inputDirectory, fixtureNames.gas),
    RESOLVE_METADATA_PATH: resolve(inputDirectory, fixtureNames.resolve),
    SONG_MASTER_PATH: resolve(inputDirectory, fixtureNames.songMaster),
    MEMBER_MASTER_PATH: resolve(inputDirectory, fixtureNames.memberMaster),
    RESOLVE_EXPORT_ROOT: resolveRoot,
    RESOLVE_EXPORT_ALLOWED_ROOTS: allowedRoots,
  };
}

function runValidator(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
  });
}

function copyFixtures(inputDirectory: string, replaceTestValues = false): void {
  for (const name of denylist.fixtureFiles) {
    const destination = resolve(inputDirectory, name);
    copyFileSync(resolve(fixturesRoot, name), destination);
    if (!replaceTestValues) continue;
    let source = readFileSync(destination, 'utf8');
    for (const item of denylist.testOnlyValues) source = source.replaceAll(item.value, item.replacement);
    writeFileSync(destination, source);
  }
}

function mutateJsonFixture<T>(inputDirectory: string, fixtureName: FixtureName, mutate: (value: T) => void): void {
  const fixturePath = resolve(inputDirectory, fixtureNames[fixtureName]);
  const value = JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
  mutate(value);
  writeFileSync(fixturePath, JSON.stringify(value));
}

function prepareProductionInputs(
  inputDirectory: string,
  mediaRoot = inputDirectory,
  mediaBytes = Buffer.from('approved production media contract'),
): void {
  copyFixtures(inputDirectory, true);
  const mediaPath = resolve(mediaRoot, 'approved-clip.mp4');
  writeFileSync(mediaPath, mediaBytes);
  mutateJsonFixture<{ path: string; sha256: string }>(inputDirectory, 'resolve', (metadata) => {
    metadata.path = mediaPath;
    metadata.sha256 = createHash('sha256').update(mediaBytes).digest('hex');
  });
}

function withTemporaryDirectory<T>(prefix: string, callback: (directory: string) => T): T {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('production input validation CLI', () => {
  it('rejects repository test fixtures as production truth', () => {
    const result = runValidator({
      ...process.env,
      INIT_CWD: repositoryRoot,
      LP_EVENT_PATH: 'packages/test-fixtures/contracts/lp-event-v1.json',
      LP_MAPPING_APPROVAL_PATH: 'packages/test-fixtures/contracts/lp-mapping-approval-v1.json',
      GAS_PAYLOAD_PATH: 'packages/test-fixtures/contracts/gas-setlist-v1.json',
      RESOLVE_METADATA_PATH: 'packages/test-fixtures/contracts/resolve-metadata-v1.json',
      SONG_MASTER_PATH: 'packages/test-fixtures/contracts/song-master-v1.json',
      MEMBER_MASTER_PATH: 'packages/test-fixtures/contracts/member-master-v1.json',
      RESOLVE_EXPORT_ROOT: '/private/tmp',
      RESOLVE_EXPORT_ALLOWED_ROOTS: '/private/tmp',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('test fixtures must not be used as production inputs');
  });

  it('rejects unchanged test fixtures copied outside the repository', () => {
    withTemporaryDirectory('cubelic-production-inputs-', (directory) => {
      copyFixtures(directory);
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('matches a known test fixture');
    });
  });

  it('rejects modified fixture copies that retain test-only identifiers', () => {
    withTemporaryDirectory('cubelic-production-placeholders-', (directory) => {
      copyFixtures(directory);
      for (const name of denylist.fixtureFiles) writeFileSync(resolve(directory, name), `${readFileSync(resolve(directory, name), 'utf8')}\n`);
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('contains test-only placeholder values');
    });
  });

  it('rejects a missing Resolve export root', () => {
    withTemporaryDirectory('cubelic-production-root-', (directory) => {
      copyFixtures(directory, true);
      const result = runValidator(inputEnvironment(directory, resolve(directory, 'missing'), directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RESOLVE_EXPORT_ROOT must be an existing directory');
    });
  });

  it('rejects an existing Resolve root outside the configured allowlist', () => {
    withTemporaryDirectory('cubelic-production-allowlist-', (directory) => {
      copyFixtures(directory, true);
      const allowed = resolve(directory, 'allowed');
      const unapproved = resolve(directory, 'unapproved');
      mkdirSync(allowed);
      mkdirSync(unapproved);
      const result = runValidator(inputEnvironment(directory, unapproved, allowed));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RESOLVE_EXPORT_ROOT is outside RESOLVE_EXPORT_ALLOWED_ROOTS');
    });
  });

  it('rejects a symlink that escapes the configured Resolve allowlist', () => {
    withTemporaryDirectory('cubelic-production-symlink-', (directory) => {
      copyFixtures(directory, true);
      const allowed = resolve(directory, 'allowed');
      const outside = resolve(directory, 'outside');
      mkdirSync(allowed);
      mkdirSync(outside);
      const escaped = resolve(allowed, 'escaped');
      symlinkSync(outside, escaped);
      const result = runValidator(inputEnvironment(directory, escaped, allowed));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RESOLVE_EXPORT_ROOT is outside RESOLVE_EXPORT_ALLOWED_ROOTS');
    });
  });

  it('does not disclose an unreadable input path in validation output', () => {
    withTemporaryDirectory('cubelic-production-redaction-', (directory) => {
      copyFixtures(directory, true);
      const environment = inputEnvironment(directory, directory, directory);
      environment.GAS_PAYLOAD_PATH = '/private/tmp/operator-private/secret-gas.json';
      const result = runValidator(environment);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GAS_PAYLOAD_PATH could not be read as JSON');
      expect(result.stderr).not.toContain('operator-private');
      expect(result.stderr).not.toContain('secret-gas.json');
    });
  });

  it('reports schema paths without echoing invalid payload values', () => {
    withTemporaryDirectory('cubelic-production-schema-', (directory) => {
      copyFixtures(directory, true);
      writeFileSync(resolve(directory, fixtureNames.gas), '{"private_value":"must-not-leak"}');
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GAS_PAYLOAD_PATH does not match');
      expect(result.stderr).not.toContain('must-not-leak');
    });
  });

  it('rejects GAS and Resolve contracts for different events', () => {
    withTemporaryDirectory('cubelic-production-event-link-', (directory) => {
      copyFixtures(directory, true);
      mutateJsonFixture<{ event_id: string }>(directory, 'resolve', (metadata) => {
        metadata.event_id = 'evt_different_production_event';
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('LP_EVENT_PATH, GAS_PAYLOAD_PATH, and RESOLVE_METADATA_PATH must reference the same event_id');
    });
  });

  it('rejects event, GAS, and Resolve contracts for different events', () => {
    withTemporaryDirectory('cubelic-production-event-contract-', (directory) => {
      prepareProductionInputs(directory);
      mutateJsonFixture<{ event_id: string }>(directory, 'event', (event) => {
        event.event_id = 'evt_different_production_event';
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('LP_EVENT_PATH, GAS_PAYLOAD_PATH, and RESOLVE_METADATA_PATH must reference the same event_id');
      expect(result.stderr).not.toContain('evt_different_production_event');
    });
  });

  it('rejects event details that disagree with the GAS contract', () => {
    withTemporaryDirectory('cubelic-production-event-details-', (directory) => {
      prepareProductionInputs(directory);
      mutateJsonFixture<{ venue: string }>(directory, 'event', (event) => {
        event.venue = 'private mismatched venue';
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('LP_EVENT_PATH and GAS_PAYLOAD_PATH event details must match');
      expect(result.stderr).not.toContain('private mismatched venue');
    });
  });

  it('rejects an LP approval for a stale event or destination', () => {
    withTemporaryDirectory('cubelic-production-lp-approval-', (directory) => {
      prepareProductionInputs(directory);
      mutateJsonFixture<{ lp_url: string }>(directory, 'lpMappingApproval', (approval) => {
        approval.lp_url = 'https://cubelic-fan.com/setlists/stale-destination';
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('LP_MAPPING_APPROVAL_PATH must approve the current GAS event_id, lp_url, and LP update state');
      expect(result.stderr).not.toContain('stale-destination');
    });
  });

  it('rejects non-consecutive GAS setlist positions', () => {
    withTemporaryDirectory('cubelic-production-setlist-order-', (directory) => {
      copyFixtures(directory, true);
      mutateJsonFixture<{ songs: Array<{ position: number }> }>(directory, 'gas', (payload) => {
        payload.songs[1].position = 3;
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GAS_PAYLOAD_PATH song positions must be consecutive from 1');
    });
  });

  it('rejects GAS songs that do not match the active song master', () => {
    withTemporaryDirectory('cubelic-production-song-link-', (directory) => {
      copyFixtures(directory, true);
      mutateJsonFixture<{ songs: Array<{ title: string }> }>(directory, 'gas', (payload) => {
        payload.songs[0].title = 'not-an-approved-title';
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GAS_PAYLOAD_PATH songs must match active SONG_MASTER_PATH ids and titles');
      expect(result.stderr).not.toContain('not-an-approved-title');
    });
  });

  it('rejects duplicate stable identifiers in production masters', () => {
    withTemporaryDirectory('cubelic-production-master-ids-', (directory) => {
      copyFixtures(directory, true);
      mutateJsonFixture<{ songs: Array<{ song_id: string }> }>(directory, 'songMaster', (songMaster) => {
        songMaster.songs[1].song_id = songMaster.songs[0].song_id;
      });
      mutateJsonFixture<{ members: Array<Record<string, unknown>> }>(directory, 'memberMaster', (memberMaster) => {
        memberMaster.members.push({ ...memberMaster.members[0] });
      });
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('SONG_MASTER_PATH song_id values must be unique');
      expect(result.stderr).toContain('MEMBER_MASTER_PATH member_id values must be unique');
    });
  });

  it('rejects Resolve media outside the approved export root', () => {
    withTemporaryDirectory('cubelic-production-media-root-', (directory) => {
      const approved = resolve(directory, 'approved');
      const outside = resolve(directory, 'outside');
      mkdirSync(approved);
      mkdirSync(outside);
      prepareProductionInputs(directory, outside);
      const result = runValidator(inputEnvironment(directory, approved, approved));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RESOLVE_METADATA_PATH media must be a file inside RESOLVE_EXPORT_ROOT');
      expect(result.stderr).not.toContain('approved-clip.mp4');
    });
  });

  it('rejects Resolve metadata whose SHA-256 does not match the media file', () => {
    withTemporaryDirectory('cubelic-production-media-hash-', (directory) => {
      prepareProductionInputs(directory);
      writeFileSync(resolve(directory, 'approved-clip.mp4'), 'tampered after sidecar generation');
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RESOLVE_METADATA_PATH sha256 must match the media file');
      expect(result.stderr).not.toContain('tampered after sidecar generation');
    });
  });

  it('hashes Resolve media across multiple stream chunks', () => {
    withTemporaryDirectory('cubelic-production-media-stream-', (directory) => {
      prepareProductionInputs(directory, directory, Buffer.alloc(2 * 1024 * 1024, 0x5a));
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Production input contracts passed');
    });
  });

  it('accepts production-shaped contracts under an approved existing root', () => {
    withTemporaryDirectory('cubelic-production-valid-', (directory) => {
      prepareProductionInputs(directory);
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Production input contracts passed');
      expect(result.stderr).toBe('');
    });
  });
});
