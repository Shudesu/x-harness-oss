import { spawnSync } from 'node:child_process';
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

function inputEnvironment(inputDirectory: string, resolveRoot: string, allowedRoots: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    INIT_CWD: repositoryRoot,
    GAS_PAYLOAD_PATH: resolve(inputDirectory, denylist.fixtureFiles[0]),
    RESOLVE_METADATA_PATH: resolve(inputDirectory, denylist.fixtureFiles[1]),
    SONG_MASTER_PATH: resolve(inputDirectory, denylist.fixtureFiles[2]),
    MEMBER_MASTER_PATH: resolve(inputDirectory, denylist.fixtureFiles[3]),
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
      writeFileSync(resolve(directory, denylist.fixtureFiles[0]), '{"private_value":"must-not-leak"}');
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('GAS_PAYLOAD_PATH does not match');
      expect(result.stderr).not.toContain('must-not-leak');
    });
  });

  it('accepts production-shaped contracts under an approved existing root', () => {
    withTemporaryDirectory('cubelic-production-valid-', (directory) => {
      copyFixtures(directory, true);
      const result = runValidator(inputEnvironment(directory, directory, directory));

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Production input contracts passed');
      expect(result.stderr).toBe('');
    });
  });
});
