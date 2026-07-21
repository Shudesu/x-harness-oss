import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

for (const [environmentName, schema] of inputs) {
  const path = process.env[environmentName];
  if (!path) {
    failures.push(`${environmentName} is not set`);
    continue;
  }
  try {
    const value = JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), path), 'utf8'));
    const validate = ajv.compile(schema);
    if (!validate(value)) {
      const fields = (validate.errors ?? []).map((error) => error.instancePath || '/').join(', ');
      failures.push(`${environmentName} does not match ${schema.$id} at: ${fields}`);
    }
  } catch (error) {
    failures.push(`${environmentName} could not be read as JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

const resolveRoot = process.env.RESOLVE_EXPORT_ROOT;
if (!resolveRoot?.startsWith('/') || resolveRoot.includes('..')) {
  failures.push('RESOLVE_EXPORT_ROOT must be an absolute path without traversal');
}

if (failures.length > 0) {
  console.error(`Production input validation failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Production input contracts passed: GAS, Resolve, song master, member master, and export root.');
