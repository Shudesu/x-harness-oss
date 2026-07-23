import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

async function schema(name) {
  return JSON.parse(await readFile(new URL(`../cubelic/${name}`, import.meta.url), 'utf8'));
}

const gasSchema = await schema('gas-setlist.schema.json');
const memberSchema = await schema('member-master.schema.json');
const resolveSchema = await schema('resolve-metadata.schema.json');
const songSchema = await schema('song-master.schema.json');
const mediaSchema = await schema('media-asset.schema.json');
const productionInputDenylist = JSON.parse(await readFile(
  new URL('../../test-fixtures/production-input-denylist.json', import.meta.url),
  'utf8',
));

const inputs = [
  ['GAS_PAYLOAD_PATH', gasSchema],
  ['RESOLVE_METADATA_PATH', resolveSchema],
  ['SONG_MASTER_PATH', songSchema],
  ['MEMBER_MASTER_PATH', memberSchema],
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(mediaSchema);
const failures = [];
const testFixturesRoot = fileURLToPath(new URL('../../test-fixtures/', import.meta.url));
const knownTestFixtureHashes = new Set(await Promise.all(
  productionInputDenylist.fixtureFiles.map(async (name) => createHash('sha256')
    .update(await readFile(new URL(`../../test-fixtures/contracts/${name}`, import.meta.url)))
    .digest('hex')),
));
const knownTestOnlyValues = new Set(productionInputDenylist.testOnlyValues.map(({ value }) => value));

function containsTestOnlyValue(value) {
  if (typeof value === 'string') return knownTestOnlyValues.has(value);
  if (Array.isArray(value)) return value.some(containsTestOnlyValue);
  if (value && typeof value === 'object') return Object.values(value).some(containsTestOnlyValue);
  return false;
}

for (const [environmentName, schema] of inputs) {
  const path = process.env[environmentName];
  if (!path) {
    failures.push(`${environmentName} is not set`);
    continue;
  }
  try {
    const inputPath = resolve(process.env.INIT_CWD ?? process.cwd(), path);
    const fixtureRelativePath = relative(testFixturesRoot, inputPath);
    if (!fixtureRelativePath.startsWith('..') && !isAbsolute(fixtureRelativePath)) {
      failures.push(`${environmentName}: test fixtures must not be used as production inputs`);
      continue;
    }
    const source = await readFile(inputPath, 'utf8');
    if (knownTestFixtureHashes.has(createHash('sha256').update(source).digest('hex'))) {
      failures.push(`${environmentName}: input matches a known test fixture`);
      continue;
    }
    const value = JSON.parse(source);
    if (containsTestOnlyValue(value)) {
      failures.push(`${environmentName}: input contains test-only placeholder values`);
      continue;
    }
    const validate = ajv.compile(schema);
    if (!validate(value)) {
      const fields = (validate.errors ?? []).map((error) => error.instancePath || '/').join(', ');
      failures.push(`${environmentName} does not match ${schema.$id} at: ${fields}`);
    }
  } catch {
    failures.push(`${environmentName} could not be read as JSON`);
  }
}

const resolveRoot = process.env.RESOLVE_EXPORT_ROOT;
if (!resolveRoot?.startsWith('/') || resolveRoot.includes('..')) {
  failures.push('RESOLVE_EXPORT_ROOT must be an absolute path without traversal');
} else {
  try {
    const canonicalResolveRoot = await realpath(resolveRoot);
    if (!(await stat(canonicalResolveRoot)).isDirectory()) {
      failures.push('RESOLVE_EXPORT_ROOT must be an existing directory');
    } else {
      const configuredAllowedRoots = (process.env.RESOLVE_EXPORT_ALLOWED_ROOTS ?? '')
        .split(',')
        .map((path) => path.trim())
        .filter(Boolean);
      const canonicalAllowedRoots = [];
      for (const allowedRoot of configuredAllowedRoots) {
        if (!isAbsolute(allowedRoot) || allowedRoot.includes('..')) continue;
        try {
          const canonicalAllowedRoot = await realpath(allowedRoot);
          if ((await stat(canonicalAllowedRoot)).isDirectory()) canonicalAllowedRoots.push(canonicalAllowedRoot);
        } catch {
          // Invalid allowlist entries fail closed below.
        }
      }
      if (canonicalAllowedRoots.length !== configuredAllowedRoots.length || canonicalAllowedRoots.length === 0) {
        failures.push('RESOLVE_EXPORT_ALLOWED_ROOTS must contain existing absolute directories');
      } else if (!canonicalAllowedRoots.some((allowedRoot) => {
        const childPath = relative(allowedRoot, canonicalResolveRoot);
        return childPath === '' || (!childPath.startsWith('..') && !isAbsolute(childPath));
      })) {
        failures.push('RESOLVE_EXPORT_ROOT is outside RESOLVE_EXPORT_ALLOWED_ROOTS');
      }
    }
  } catch {
    failures.push('RESOLVE_EXPORT_ROOT must be an existing directory');
  }
}

if (failures.length > 0) {
  console.error(`Production input validation failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Production input contracts passed: GAS, Resolve, song master, member master, and export root.');
