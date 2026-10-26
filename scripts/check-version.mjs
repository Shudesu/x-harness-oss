import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const tag=process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:undefined;
if(tag && tag!==`v${version}`)throw new Error(`Tag ${tag} differs from v${version}`);
for(const name of ['worker','web'])if(JSON.parse(readFileSync(new URL(`../apps/${name}/package.json`,import.meta.url))).version!==version)throw new Error('App version differs from root');
console.log(`Version ${version} consistent`);
