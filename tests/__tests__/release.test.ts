import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { checkVersion,versionArtifacts } from '../../scripts/release-version.mjs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
describe('release gate',()=>{
 it('accepts aligned versioned artifacts and tag',()=>expect(()=>checkVersion(version,`v${version}`)).not.toThrow());
 it('blocks a mismatched tag before release',()=>expect(()=>checkVersion(version,'v99.0.0')).toThrow('differs'));
 it.each(['0.0.0','v0.6.0','0.06.0','latest','../0.6.0'])('rejects invalid stable release identifier %s',v=>expect(()=>versionArtifacts(v)).toThrow());
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('restores annotation lost during checkout without moving the remote tag',()=>{
 const directory=mkdtempSync(join(tmpdir(),'xh-tag-guard-'));
 const remote=join(directory,'remote.git'),repo=join(directory,'repo');mkdirSync(repo);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(directory,'init','--bare','--initial-branch=main',remote);git(repo,'init','--initial-branch=main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'fixture'),'test');git(repo,'add','fixture');git(repo,'commit','-m','fixture');git(repo,'remote','add','origin',remote);git(repo,'tag','-a','v0.6.0','-m','fixture');git(repo,'push','origin','main','refs/tags/v0.6.0');
  const annotation=git(repo,'rev-parse','v0.6.0');git(repo,'update-ref','refs/tags/v0.6.0',git(repo,'rev-parse','HEAD'));expect(git(repo,'cat-file','-t','v0.6.0')).toBe('commit');
  const workflow=readFileSync('.github/workflows/release.yml','utf8');
  const start=workflow.indexOf('          set -euo pipefail');const end=workflow.indexOf('          GITHUB_REF_TYPE=tag',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  const guard=workflow.slice(start,end).split('\n').map(line=>line.slice(10)).join('\n');
  execFileSync('bash',['-c',guard],{cwd:repo,env:{...process.env,RELEASE_TAG:'v0.6.0'},stdio:['ignore','pipe','pipe']});
  expect(git(repo,'cat-file','-t','v0.6.0')).toBe('tag');expect(git(repo,'rev-parse','v0.6.0')).toBe(annotation);
  expect(git(directory,'--git-dir',remote,'rev-parse','refs/tags/v0.6.0')).toBe(annotation);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
