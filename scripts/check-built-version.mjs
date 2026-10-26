import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const version = JSON.parse(readFileSync('package.json','utf8')).version;
const publicVersion = JSON.parse(readFileSync('apps/web/out/version.json','utf8'));
if (publicVersion.version !== version) throw new Error('Exported version.json mismatch');
function files(path) {return readdirSync(path,{withFileTypes:true}).flatMap(entry => entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)]);}
const scripts = files('apps/web/out/_next/static').filter(path=>path.endsWith('.js'));
const sidebar = scripts.map(path=>readFileSync(path,'utf8')).filter(text=>text.includes('X Harness v'));
if (!sidebar.length || !sidebar.some(text=>text.includes(version))) throw new Error('Built sidebar has no release version');
if (sidebar.some(text=>text.includes('process.env.APP_VERSION'))) throw new Error('Unresolved APP_VERSION in browser bundle');
console.log(`Static export contains v${version}; no unresolved APP_VERSION`);
