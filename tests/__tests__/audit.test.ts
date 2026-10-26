import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { describe,it,expect,vi,afterEach } from 'vitest';
import worker from '../../apps/worker/src/index.js';
import { createScheduledPost,getDueScheduledPosts,encryptSecret,decryptSecret,createStaffMember,getXAccounts } from '../../packages/db/src/index.js';
import { processScheduledPosts } from '../../apps/worker/src/services/post-scheduler.js';
import { buildXClient } from '../../apps/worker/src/services/x-client.js';
import { GrokClient, calculateAiCost } from '../../apps/worker/src/services/grok.js';
import { takeQuota } from '../../apps/worker/src/services/rate-limit.js';
import { XClient } from '../../packages/x-sdk/src/client.js';
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync('packages/db/bootstrap').sort())sqlite.exec(readFileSync(`packages/db/bootstrap/${file}`,'utf8'));
 const wrap=(sql:string,values:unknown[]=[])=>({bind:(...params:unknown[])=>wrap(sql,params),all:async()=>({results:sqlite.prepare(sql).all(...values as any)}),first:async()=>sqlite.prepare(sql).get(...values as any)??null,run:async()=>({meta:{changes:sqlite.prepare(sql).run(...values as any).changes}})});
 const db={prepare:(sql:string)=>wrap(sql),batch:async(statements:any[])=>Promise.all(statements.map(s=>s.run()))} as any;
 return {db,sqlite};
}
const key=Buffer.alloc(32,1).toString('base64');
const ctx={waitUntil:()=>{},passThroughOnException:()=>{}} as any;
function request(env:any,path:string,token?:string,method='GET',body?:unknown){return worker.fetch(new Request(`https://worker.example${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);}
function seed(sqlite:DatabaseSync){sqlite.exec("INSERT INTO x_accounts(id,x_user_id,username,access_token,created_at,updated_at) VALUES ('a','123','example','token','2026-10-01','2026-10-01')");}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('security and cost integration against SQLite',()=>{
 it('normalizes UTC, explicit offset and legacy JST, and becomes due only at the intended instant',async()=>{
  const {db}=database();
  for(const value of ['2026-10-26T12:00:00Z','2026-10-26T12:00:00+00:00','2026-10-26 21:00:00']){const p=await createScheduledPost(db,'a','test',value);expect(p.scheduled_at).toBe('2026-10-26T21:00:00.000+09:00');}
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T11:59:59Z'));expect(await getDueScheduledPosts(db)).toHaveLength(0);
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));expect(await getDueScheduledPosts(db)).toHaveLength(3);
  await expect(createScheduledPost(db,'a','bad','garbage')).rejects.toThrow();
 });
 it('claims a scheduled send once across concurrent cron executions',async()=>{
  const {db}=database();await createScheduledPost(db,'a','one','2020-01-01T00:00:00Z');
  const client={createTweet:vi.fn(async()=>({id:'tweet'}))} as any;
  await Promise.all([processScheduledPosts(db,client,'a'),processScheduledPosts(db,client,'a')]);expect(client.createTweet).toHaveBeenCalledTimes(1);
 });
 it('does not resend an ambiguous timeout',async()=>{
  const {db}=database();await createScheduledPost(db,'a','one','2020-01-01T00:00:00Z');const client={createTweet:vi.fn(async()=>{throw new Error('timeout');})} as any;
  await processScheduledPosts(db,client,'a');await processScheduledPosts(db,client,'a');expect(client.createTweet).toHaveBeenCalledTimes(1);
 });
 it('encrypts with randomized authenticated ciphertext and rejects a wrong key',async()=>{
  const a=await encryptSecret('secret',key),b=await encryptSecret('secret',key);expect(a).not.toBe(b);expect(a).not.toContain('secret');expect(await decryptSecret(a,key)).toBe('secret');await expect(decryptSecret(a,Buffer.alloc(32,2).toString('base64'))).rejects.toThrow();
 });
 it('enforces admin/editor/viewer access and never exposes LINE secrets',async()=>{
  const {db,sqlite}=database();const env={DB:db,API_KEY:'master',ENCRYPTION_KEY:key};
  for(const role of ['admin','editor','viewer'] as const)await createStaffMember(db,{name:role,role,apiKey:role});
  sqlite.exec("INSERT INTO line_connections VALUES ('l','line','https://line.example','secret','now')");
  expect(sqlite.prepare("SELECT api_key FROM staff_members WHERE name='viewer'").get()?.api_key).not.toBe('viewer');
  for(const role of ['viewer','editor']){expect((await request(env,'/api/line-connections/l',role)).status).toBe(403);expect((await request(env,'/api/settings',role,'PUT',{auto_features_enabled:'true'})).status).toBe(403);expect((await request(env,'/api/x-accounts/a',role,'PUT',{accessToken:'attack'})).status).toBe(403);}
  const response=await request(env,'/api/line-connections/l','admin');expect(response.status).toBe(200);const json=await response.json() as any;expect(json.data.api_key).toBeUndefined();expect(json.data.hasApiKey).toBe(true);
  expect((await request(env,'/api/posts','viewer','POST',{text:'x'})).status).toBe(403);
 });
 it('rejects unauthenticated public search without a valid gate before spending',async()=>{
  const {db}=database();const spy=vi.fn();vi.stubGlobal('fetch',spy);
  const response=await request({DB:db,API_KEY:'master'},'/api/users/search?q=abc&limit=1');expect(response.status).toBe(404);expect(spy).not.toHaveBeenCalled();
  expect((await request({DB:db,API_KEY:'master'},'/api/followers/search?q=abc')).status).toBe(401);
 });
 it('atomically limits concurrent reservations',async()=>{
  const {db}=database();const result=await Promise.all(Array.from({length:12},()=>takeQuota(db,'test',60000,5)));expect(result.filter(Boolean)).toHaveLength(5);
 });
 it('caps search at the requested resource count and batches IDs into 100',async()=>{
  const spy=vi.fn(async()=>new Response(JSON.stringify({data:[]})));vi.stubGlobal('fetch',spy);const c=new XClient('token');await c.searchUsers('abc',1);expect(String(spy.mock.calls[0][0])).toContain('max_results=1');spy.mockClear();await c.getUsersByIds([...Array.from({length:201},(_,i)=>String(i)),'0']);expect(spy).toHaveBeenCalledTimes(3);
 });
 it('records returned resource counts and stops once budget is reached',async()=>{
  const {db,sqlite}=database();seed(sqlite);sqlite.exec("INSERT INTO settings(key,value) VALUES ('x_monthly_budget_usd','0.02')");
  const spy=vi.fn(async()=>new Response(JSON.stringify({data:[{id:'1'},{id:'2'}]})));vi.stubGlobal('fetch',spy);
  const c=await buildXClient({DB:db,API_KEY:'master'} as any,(await getXAccounts(db))[0]);await c.searchUsers('abc',2);
  expect(sqlite.prepare('SELECT SUM(cost_usd) AS cost FROM api_spend_ledger').get()?.cost).toBe(.02);await expect(c.searchUsers('abc',2)).rejects.toThrow('budget');expect(spy).toHaveBeenCalledTimes(1);
 });
 it('issues expiring sessions and invalidates staff sessions when access is revoked',async()=>{
  const {db,sqlite}=database();const env={DB:db,API_KEY:'master'};await createStaffMember(db,{name:'staff',role:'editor',apiKey:'staff'});
  const response=await request(env,'/api/auth/session',undefined,'POST',{apiKey:'staff'});expect(response.status).toBe(200);const result=await response.json() as any;
  expect((await request(env,'/api/x-accounts',result.data.token)).status).toBe(200);
  sqlite.exec('UPDATE staff_members SET is_active=0');expect((await request(env,'/api/x-accounts',result.data.token)).status).toBe(401);
 });
 it('calculates cached tokens and x_search fetched resources separately',()=>{
  expect(calculateAiCost('grok-4.3',{inputTokens:1000,cachedTokens:500,outputTokens:100,xPostsFetched:2,xUsersFetched:1})).toBeCloseTo(.020975);
 });
 it('does not call xAI without a key or after the AI budget is exhausted',async()=>{
  const {db,sqlite}=database();const spy=vi.fn();vi.stubGlobal('fetch',spy);await expect(new GrokClient({DB:db} as any,'a','digest').respond({input:[]})).rejects.toThrow('not configured');
  sqlite.exec("INSERT INTO settings(key,value) VALUES ('xai_monthly_budget_usd','0')");await expect(new GrokClient({DB:db,XAI_API_KEY:'test'} as any,'a','digest').respond({input:[]})).rejects.toThrow('budget');expect(spy).not.toHaveBeenCalled();
 });
});

describe('upgrade and provider boundaries',()=>{
 it('upgrades legacy secrets without returning plaintext or changing their value',async()=>{
  const {db,sqlite}=database();seed(sqlite);sqlite.exec("INSERT INTO line_connections VALUES ('l','line','https://line.example','line-secret','now')");
  const env={DB:db,API_KEY:'master',ENCRYPTION_KEY:key};
  const dry=await request(env,'/api/maintenance/secrets','master');expect(dry.status).toBe(200);expect(await dry.text()).not.toContain('line-secret');
  expect((await request(env,'/api/maintenance/secrets','master','POST',{})).status).toBe(200);
  const value=sqlite.prepare("SELECT api_key FROM line_connections WHERE id='l'").get()?.api_key as string;expect(value).toMatch(/^enc:v1:/);expect(await decryptSecret(value,key)).toBe('line-secret');
  expect((await request(env,'/api/maintenance/secrets','master','POST',{})).status).toBe(200);
 });
 it('records Grok token and tool charges even if output JSON is malformed',async()=>{
  const {db,sqlite}=database();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}],usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:500},server_side_tool_usage_details:{x_posts_fetched:2,x_users_fetched:1}}}))));
  await expect(new GrokClient({DB:db,XAI_API_KEY:'synthetic'} as any,'a','research').respond({input:[],jsonSchema:{}})).rejects.toThrow('Invalid AI JSON');
  expect(sqlite.prepare('SELECT cost_usd FROM ai_runs').get()?.cost_usd).toBeCloseTo(.020975);expect(sqlite.prepare("SELECT SUM(cost_usd) AS cost_usd FROM api_spend_ledger WHERE source='xai'").get()?.cost_usd).toBeCloseTo(.020975);
 });
 it('does not forward X credentials to an arbitrary raw-fetch destination',async()=>{
  const spy=vi.fn();vi.stubGlobal('fetch',spy);await expect(new XClient('synthetic').fetchRaw('https://attacker.example/2/media/upload',{method:'POST'})).rejects.toThrow('Untrusted');expect(spy).not.toHaveBeenCalled();
 });
 it('rejects an OAuth callback without a valid single-use state before contacting X',async()=>{
  const {db}=database();const spy=vi.fn();vi.stubGlobal('fetch',spy);
  const response=await request({DB:db,API_KEY:'master',X_OAUTH_CLIENT_ID:'client'},'/api/x/oauth/callback?state=forged&code=code');expect(response.status).toBe(400);expect(spy).not.toHaveBeenCalled();
 });
 it('respects allowed dashboard origins and denies arbitrary origins',async()=>{
  const {db}=database();const env={DB:db,API_KEY:'master',ADMIN_ORIGIN:'https://admin.example'};
  for(const [origin,allowed] of [['https://admin.example',true],['https://evil.example',false]] as const){const response=await worker.fetch(new Request('https://worker.example/api/settings',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT'}}),env as any,ctx);expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed?origin:null);}
 });
 it('sends explicitly scheduled posts even with optional automation disabled',async()=>{
  const {db,sqlite}=database();seed(sqlite);await createScheduledPost(db,'a','explicit','2020-01-01T00:00:00Z');
  const spy=vi.fn(async(url:string,init?:RequestInit)=>new Response(JSON.stringify({data:init?.method==='POST'?{id:'posted',text:'explicit'}:{id:'123',username:'example',public_metrics:{followers_count:1,following_count:1,tweet_count:1}}})));vi.stubGlobal('fetch',spy);
  await worker.scheduled({scheduledTime:Date.now()} as any,{DB:db,API_KEY:'master'} as any,ctx);
  expect(sqlite.prepare('SELECT status FROM scheduled_posts').get()?.status).toBe('posted');expect(spy.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 });
 it('refreshes an expiring OAuth credential and persists encrypted rotated tokens',async()=>{
  const {db,sqlite}=database();seed(sqlite);sqlite.exec("UPDATE x_accounts SET refresh_token='old-refresh',oauth_client_id='client',token_expires_at=1");
  const spy=vi.fn(async()=>new Response(JSON.stringify({access_token:'new-token',refresh_token:'new-refresh',expires_in:7200})));vi.stubGlobal('fetch',spy);
  await buildXClient({DB:db,API_KEY:'master',ENCRYPTION_KEY:key} as any,(await getXAccounts(db))[0]);const row=sqlite.prepare('SELECT access_token,refresh_token,token_expires_at FROM x_accounts').get()!;
  expect(await decryptSecret(row.access_token as string,key)).toBe('new-token');expect(await decryptSecret(row.refresh_token as string,key)).toBe('new-refresh');expect(Number(row.token_expires_at)).toBeGreaterThan(Date.now());expect(spy).toHaveBeenCalledTimes(1);
 });
});

it('queues current XAA reply envelopes only after signature verification and deduplicates event estimates',async()=>{
 const {db,sqlite}=database();seed(sqlite);sqlite.exec("UPDATE x_accounts SET consumer_secret='webhook-secret'; INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at) VALUES ('g','a','777','reply','dm','hello','now','now')");
 const body=JSON.stringify({data:{event_uuid:'event1',event_type:'post.create',payload:{id:'888',author_id:'456',in_reply_to_tweet_id:'777',text:'question'},includes:{users:[{id:'456',username:'guest',name:'Guest'}]}}});
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode('webhook-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature='sha256='+Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(body))).toString('base64');
 const pending:Promise<unknown>[]=[];const context={...ctx,waitUntil:(p:Promise<unknown>)=>pending.push(p)};
 for(const sig of ['invalid',signature,signature]){await worker.fetch(new Request('https://worker.example/webhook/xaa?accountId=a',{method:'POST',headers:{'Content-Type':'application/json','x-twitter-webhooks-signature':sig},body}),{DB:db,API_KEY:'master'} as any,context);await Promise.all(pending);}
 expect(sqlite.prepare('SELECT COUNT(*) AS total FROM reply_trigger_queue').get()?.total).toBe(1);expect(sqlite.prepare("SELECT SUM(cost_usd) AS cost FROM api_spend_ledger WHERE feature='xaa'").get()?.cost).toBe(.005);
});
