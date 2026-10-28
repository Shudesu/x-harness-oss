import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {Hono} from '../../apps/worker/node_modules/hono/dist/index.js';
import {issueClaim} from '../../apps/worker/src/services/claim-codes.js';
import {configureExternalSource,startExternalScan,importExternalPage,parseExternalPage,externalSourceStatus} from '../../apps/worker/src/services/external-source.js';
import {pollClaimGate} from '../../apps/worker/src/services/claim-poller.js';
import {pollAccountGates} from '../../apps/worker/src/services/claim-batch-poller.js';
import {captureClosedGateMetrics} from '../../apps/worker/src/services/gate-metrics.js';
import {authMiddleware} from '../../apps/worker/src/middleware/auth.js';
import {externalSource} from '../../apps/worker/src/routes/external-source.js';
import type {Env} from '../../apps/worker/src/index.js';
const now=Date.parse('2026-10-27T10:00:00Z');
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("packages/db/bootstrap").sort())
    sqlite.exec(readFileSync(`packages/db/bootstrap/${file}`, "utf8"));
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as any)) }),
    first: async () => sqlite.prepare(sql).get(...(values as any)) ?? null,
    run: async () => ({
      meta: { changes: sqlite.prepare(sql).run(...(values as any)).changes },
    }),
    _run: () => ({
      meta: { changes: sqlite.prepare(sql).run(...(values as any)).changes },
    }),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = list.map((s) => s._run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as any;
  sqlite.exec(
    "INSERT INTO x_accounts(id,x_user_id,username,access_token,created_at,updated_at) VALUES ('a','999','brand','fixture','2026-01-01','2026-01-01')",
  );
  sqlite
    .prepare(
      "INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at,gate_mode,slug,title,ends_at,claim_phrase,brand_username,gate_state) VALUES ('g','a','999','reply','verify_only','','2026-10-26','2026-10-26','line_first','spring','春の特典',?,'春プレ','brand','active')",
    )
    .run(new Date(now + 7 * 86400000).toISOString());
  const gate = sqlite
    .prepare("SELECT * FROM engagement_gates WHERE id='g'")
    .get() as any;
  return { sqlite, db, gate };
}

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function enabled(){
 const f=fixture();f.sqlite.exec("UPDATE engagement_gates SET is_active=0 WHERE id='g'");
 await configureExternalSource(f.db,'g',true,now);f.sqlite.exec("UPDATE engagement_gates SET is_active=1 WHERE id='g'");
 const network=vi.fn(()=>{throw new Error('No external network permitted');});vi.stubGlobal('fetch',network);
 return {...f,network};
}
const author=(id:string)=>({id,username:'user'+id,created_at:'2020-01-01T00:00:00Z',protected:false});
const post=(code:string,id:string,user:string,at:number)=>({id,author_id:user,text:'春プレ-'+code,created_at:new Date(at).toISOString(),conversation_id:'999'});
const page=(job:any,posts:any[]=[],authors:any[]=[],nextToken:string|null=null)=>parseExternalPage({epoch:job.epoch,scanId:job.scanId,page:job.page,requestToken:job.nextToken,nextToken,posts,authors});
it('requires a paused supported gate and rejects changes during pending settlement',async()=>{
 const f=fixture();await expect(configureExternalSource(f.db,'g',true,now)).rejects.toThrow('pause_campaign');
 f.sqlite.exec("UPDATE engagement_gates SET is_active=0,tier='strict' WHERE id='g'");await expect(configureExternalSource(f.db,'g',true,now)).rejects.toThrow('standard_reply_only');
 f.sqlite.exec("UPDATE engagement_gates SET tier='standard',follow_policy='verify_winners' WHERE id='g'");await expect(configureExternalSource(f.db,'g',true,now)).rejects.toThrow('standard_reply_only');
});
it('waits for all pages and a fresh post-settlement scan, awards by post time, never calls paid APIs, and replays safely',async()=>{
 const {db,sqlite,gate,network}=await enabled();
 sqlite.exec("INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota,weight,is_consolation) VALUES ('r','g',1,'Prize','line_message','Thanks',1,1,0)");
 const a=await issueClaim(db,gate,'friend-a',now),b=await issueClaim(db,gate,'friend-b',now);
 vi.setSystemTime(now+60000);const scan=await startExternalScan(db,'g',Date.now());
 const first=page(scan,[post(b.claim!.code,'102','20',now+20000)],[author('20')],'next');
 await importExternalPage(db,'g',first,Date.now());
 expect(sqlite.prepare('SELECT issued FROM gate_rewards').get()?.issued).toBe(0);
 await expect(importExternalPage(db,'g',{...first,page:2},Date.now())).rejects.toThrow('page_out_of_order');
 const second=page(await startExternalScan(db,'g',Date.now()),[post(a.claim!.code,'101','10',now+10000)],[author('10')]);
 await importExternalPage(db,'g',second,Date.now());
 expect(sqlite.prepare('SELECT issued FROM gate_rewards').get()?.issued).toBe(0);
 expect(await importExternalPage(db,'g',second,Date.now())).toMatchObject({replayed:true});
 await expect(importExternalPage(db,'g',{...second,posts:[]},Date.now())).rejects.toThrow('replay_conflict');
 await pollClaimGate({DB:db} as any,'g',Date.now());
 vi.setSystemTime(now+150000);const next=await startExternalScan(db,'g',Date.now());
 await importExternalPage(db,'g',page(next),Date.now());
 const outcomes=sqlite.prepare('SELECT line_friend_id,outcome,rank FROM gate_participants ORDER BY rank').all();
 expect(outcomes.map(p=>[p.line_friend_id,p.outcome,p.rank])).toEqual([['friend-a','won',1],['friend-b','lost',2]]);
 await importExternalPage(db,'g',page(next),Date.now());await pollClaimGate({DB:db} as any,'g',Date.now());
 expect(sqlite.prepare('SELECT issued FROM gate_rewards').get()?.issued).toBe(1);
 expect(sqlite.prepare("SELECT COUNT(*) n FROM event_outbox WHERE event='x.gate.reward_unlocked'").get()?.n).toBe(2);
 sqlite.exec("INSERT INTO settings(key,value) VALUES ('claim_batch_search','true')");
 await pollAccountGates({DB:db} as any,'a',Date.now());await captureClosedGateMetrics({DB:db} as any);
 expect(network).not.toHaveBeenCalled();
});
it('rejects missing facts and guessed decisions without consuming a page',async()=>{
 const {db,gate,sqlite}=await enabled();const claim=await issueClaim(db,gate,'friend',now);
 vi.setSystemTime(now+60000);const scan=await startExternalScan(db,'g',Date.now());
 expect(()=>page(scan,[post(claim.claim!.code,'101','10',now+10000)],[])).toThrow('incomplete_post');
 expect(()=>parseExternalPage({...page(scan),eligible:true})).toThrow('unexpected_field');
 expect(()=>parseExternalPage({...page(scan),posts:[null]})).toThrow();
 const outside=page(scan,[post(claim.claim!.code,'101','10',now+59000)],[author('10')]);
 await expect(importExternalPage(db,'g',outside,Date.now())).rejects.toThrow('post_outside_scan');
 expect(sqlite.prepare('SELECT COUNT(*) n FROM gate_external_receipts').get()?.n).toBe(0);
});
it('halts on stale input, expired scans and unsupported condition changes',async()=>{
 const {db,sqlite,network}=await enabled();vi.setSystemTime(now+60000);const old=await startExternalScan(db,'g',Date.now());
 vi.setSystemTime(now+700000);await expect(importExternalPage(db,'g',page(old),Date.now())).rejects.toThrow('scan_expired');
 const fresh=await startExternalScan(db,'g',Date.now());await importExternalPage(db,'g',page(fresh),Date.now());
 vi.setSystemTime(now+900000);expect((await externalSourceStatus(db,'g',Date.now())).state).toBe('stale');
 sqlite.exec("UPDATE engagement_gates SET follow_policy='verify_winners' WHERE id='g'");
 await pollClaimGate({DB:db} as any,'g',Date.now());expect(network).not.toHaveBeenCalled();
 await expect(startExternalScan(db,'g',Date.now())).rejects.toThrow('unsupported_conditions');
});
it('authenticates the purpose-bound Cloud signature and rejects body/path tampering without a network call',async()=>{
 const {db}=fixture(),secret='test-only-source-secret';const app=new Hono<Env>();app.use('*',authMiddleware);app.route('/',externalSource);
 const env={DB:db,API_KEY:'fixture-api-key',ADMIN_SSO_SECRET:secret} as any;
 const url='https://fixture.example/api/integrations/agent-source/gates',stamp=String(now);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sign=async(path:string,method='GET',body='')=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`xh-agent-source-v1\n${stamp}\n${method}\n${path}\n${body}`)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 expect((await app.request(url,{},env)).status).toBe(401);
 const denied=await app.request(url.replace('/gates','/g/mode'),{method:'POST',headers:{Authorization:'Bearer fixture-api-key','Content-Type':'application/json'},body:JSON.stringify({enabled:true,confirm:'owner_accepts_external_observations'})},env);
 expect(denied.status).toBe(409);expect(await denied.text()).toContain('pause_campaign');
 const headers={'X-Harness-Source-Time':stamp,'X-Harness-Source-Signature':await sign(new URL(url).pathname)};
 expect((await app.request(url,{headers},env)).status).toBe(200);
 expect((await app.request(url.replace('/gates','/g/scan'),{method:'POST',headers,body:'{}'},env)).status).toBe(401);
 vi.setSystemTime(now+61000);expect((await app.request(url,{headers},env)).status).toBe(401);
});
it('refuses source changes while an account search holds its lease',async()=>{
 const {db,sqlite}=fixture();sqlite.exec("UPDATE engagement_gates SET is_active=0 WHERE id='g'");
 sqlite.prepare('INSERT INTO claim_search_cursors(x_account_id,updated_at,lease_owner,lease_until) VALUES (?,?,?,?)').run('a',now,'search',now+60000);
 await expect(configureExternalSource(db,'g',true,now)).rejects.toThrow('account_scan_in_progress');
 expect(sqlite.prepare('SELECT COUNT(*) n FROM gate_external_sources').get()?.n).toBe(0);
});
it('recovers a crash between matching and the atomic receipt without double-matching or paid fallback',async()=>{
 const {db,sqlite,gate,network}=await enabled();const claim=await issueClaim(db,gate,'friend',now);
 vi.setSystemTime(now+60000);const scan=await startExternalScan(db,'g',Date.now()),input=page(scan,[post(claim.claim!.code,'101','10',now+10000)],[author('10')]);
 const batch=db.batch.bind(db);let calls=0;db.batch=async(list:any[])=>{if(++calls===2)throw new Error('fixture receipt interrupted');return batch(list);};
 await expect(importExternalPage(db,'g',input,Date.now())).rejects.toThrow('receipt interrupted');
 expect(sqlite.prepare('SELECT COUNT(*) n FROM gate_external_receipts').get()?.n).toBe(0);
 await importExternalPage(db,'g',input,Date.now());
 expect(sqlite.prepare('SELECT COUNT(*) n FROM gate_reply_candidates').get()?.n).toBe(1);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM gate_external_receipts').get()?.n).toBe(1);
 expect(network).not.toHaveBeenCalled();
});
