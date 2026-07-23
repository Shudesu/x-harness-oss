import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignored = new Set(['.git', '.next', '.turbo', 'coverage', 'dist', 'node_modules']);
const textExtensions = new Set(['.env', '.example', '.js', '.json', '.md', '.mjs', '.sql', '.toml', '.ts', '.tsx', '.yaml', '.yml']);
const highConfidenceSecrets = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[opsu]_[A-Za-z0-9_]{30,}\b/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

async function collect(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collect(child));
    else files.push(child);
  }
  return files;
}

const findings = [];
for (const file of await collect(root)) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (name === '.env' || name === '.dev.vars' || /\.(?:pem|key|p12|pfx)$/.test(name)) {
    findings.push(`${relative(root, file)}: secret-bearing file must not be committed`);
    continue;
  }
  if (!textExtensions.has(extname(name)) && !name.startsWith('.env.')) continue;
  const source = await readFile(file, 'utf8').catch(() => '');
  for (const [label, pattern] of highConfidenceSecrets) {
    if (pattern.test(source)) findings.push(`${relative(root, file)}: possible ${label}`);
  }
}

if (findings.length) {
  console.error(`Secret scan failed:\n- ${findings.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Secret scan passed. No high-confidence committed credentials were found.');
}
