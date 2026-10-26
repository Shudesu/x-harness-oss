import { readFileSync } from 'node:fs';
import { checkVersion, root } from './release-version.mjs';
const version = JSON.parse(readFileSync(`${root}/package.json`,'utf8')).version;
checkVersion(version, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
console.log(`Version v${version}: manifests, UI/API constant, public metadata, notes and changelog match`);
