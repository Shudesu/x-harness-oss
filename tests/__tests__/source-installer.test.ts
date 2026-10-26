import { mkdtempSync, mkdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it,vi } from 'vitest';
import { generateMcpConfig } from '../../packages/create-x-harness/src/steps/mcp-config.js';

it('configures the MCP built from the same checkout and protects generated credentials',()=>{
 const directory=mkdtempSync(join(tmpdir(),'xh-release-config-'));
 mkdirSync(join(directory,'.git'));
 const cwd=vi.spyOn(process,'cwd').mockReturnValue(directory);
 try {
  const entry=join(directory,'packages/mcp/dist/index.js');
  generateMcpConfig({workerUrl:'https://worker.example',apiKey:'synthetic',mcpEntry:entry});
  const config=JSON.parse(readFileSync(join(directory,'.mcp.json'),'utf8')).mcpServers['x-harness'];
  expect(config.command).toBe('node');expect(config.args).toEqual([entry]);
  expect(readFileSync(join(directory,'.gitignore'),'utf8')).toContain('.mcp.json');
  expect(statSync(join(directory,'.mcp.json')).mode & 0o777).toBe(0o600);
 } finally {cwd.mockRestore();rmSync(directory,{recursive:true,force:true});}
});
