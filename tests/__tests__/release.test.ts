import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { checkVersion,versionArtifacts } from '../../scripts/release-version.mjs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
describe('release gate',()=>{
 it('accepts aligned versioned artifacts and tag',()=>expect(()=>checkVersion(version,`v${version}`)).not.toThrow());
 it('blocks a mismatched tag before release',()=>expect(()=>checkVersion(version,'v99.0.0')).toThrow('differs'));
 it.each(['0.0.0','v0.6.0','0.06.0','latest','../0.6.0'])('rejects invalid stable release identifier %s',v=>expect(()=>versionArtifacts(v)).toThrow());
});
