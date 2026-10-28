import type { ClaimGate, ClaimPost, ClaimAuthor, ClaimCode, GateParticipant } from './claim-types.js';
import { matchClaimPosts } from './reply-code-matcher.js';
import { withGateLock, finalizeParticipant } from './gate-rewards.js';
export class ExternalSourceError extends Error {}
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new ExternalSourceError(message); }
export interface ExternalSource {
 gate_id:string; enabled:number; epoch:string; enabled_at:number; scan_id:string|null; scan_expires_at:number|null;
 scan_from:number|null; scan_until:number|null; next_page:number; next_token:string|null; last_complete_at:number|null; coverage_until:number|null;
}
export const readExternalSource=(db:D1Database,id:string)=>db.prepare('SELECT * FROM gate_external_sources WHERE gate_id=?').bind(id).first<ExternalSource>();
export function supportsExternalSource(g:ClaimGate) {
 return g.gate_mode==='line_first' && g.tier==='standard' && !g.require_follow && !g.require_like && !g.require_repost && g.follow_policy!=='verify_winners' && g.like_policy!=='verify_winners';
}
async function gate(db:D1Database,id:string) {
 const g=await db.prepare("SELECT * FROM engagement_gates WHERE id=? AND gate_mode='line_first' AND archived_at IS NULL").bind(id).first<ClaimGate>();
 requireValue(g,'campaign_unavailable');return g;
}
export async function configureExternalSource(db:D1Database,id:string,enabled:boolean,now=Date.now()) {
 const result=await withGateLock(db,id,async()=>{
  const g=await gate(db,id);
  requireValue(!g.is_active || g.gate_state==='draft','pause_campaign_before_source_change');
  if(enabled)requireValue(supportsExternalSource(g),'external_source_requires_standard_reply_only');
  requireValue(!await db.prepare('SELECT x_account_id FROM claim_search_cursors WHERE x_account_id=? AND lease_until>?').bind(g.x_account_id,now).first(),'account_scan_in_progress');
  requireValue(!await db.prepare("SELECT id FROM claim_codes WHERE gate_id=? AND status IN ('provisional','matched') LIMIT 1").bind(id).first(),'settle_existing_claims_before_source_change');
  const old=await readExternalSource(db,id);if(!!old?.enabled===enabled)return {enabled};
  await db.batch([
   db.prepare('INSERT INTO gate_external_sources(gate_id,enabled,epoch,enabled_at) VALUES (?,?,?,?) ON CONFLICT(gate_id) DO UPDATE SET enabled=excluded.enabled,epoch=excluded.epoch,enabled_at=excluded.enabled_at,scan_id=NULL,scan_expires_at=NULL,scan_from=NULL,scan_until=NULL,next_page=0,next_token=NULL,last_complete_at=NULL,coverage_until=NULL').bind(id,enabled?1:0,crypto.randomUUID(),now),
   db.prepare('UPDATE engagement_gates SET scan_cursor=NULL,scan_newest_id=NULL,scan_mode=NULL,scan_start_at=NULL WHERE id=?').bind(id),
   db.prepare("INSERT INTO gate_events(id,gate_id,type,at,meta) VALUES (?,?,'source_changed',?,?)").bind(crypto.randomUUID(),id,now,JSON.stringify({source:enabled?'external':'x_api',automaticFallback:false})),
  ]);
  return {enabled};
 });requireValue(result,'campaign_busy');return result;
}
export async function externalSourceStatus(db:D1Database,id:string,now=Date.now()) {
 const g=await gate(db,id),s=await readExternalSource(db,id);
 return {gateId:g.id,title:g.title,active:!!g.is_active && g.gate_state==='active',supported:supportsExternalSource(g),source:s?.enabled?'external':'x_api',epoch:s?.epoch??null,lastCompleteAt:s?.last_complete_at??null,coverageUntil:s?.coverage_until??null,state:!s?.enabled?'x_api':!supportsExternalSource(g)?'unsupported_conditions':s.scan_id?((s.scan_expires_at??0)<=now?'stale':'receiving'):!s.last_complete_at?'awaiting_data':now-(s.coverage_until??0)>120000?'stale':'ready',automaticPaidFallback:false};
}
export async function startExternalScan(db:D1Database,id:string,now=Date.now()) {
 const result=await withGateLock(db,id,async()=>{
  const g=await gate(db,id),s=await readExternalSource(db,id);
  requireValue(s?.enabled,'external_source_not_enabled');requireValue(supportsExternalSource(g),'unsupported_conditions');
  requireValue(g.is_active && g.gate_state==='active','campaign_not_active');
  if(!s.scan_id || (s.scan_expires_at??0)<=now){
   const first=await db.prepare("SELECT MIN(issued_at) at FROM claim_codes WHERE gate_id=? AND status IN ('awaiting_reply','provisional','matched')").bind(id).first<{at:number|null}>();
   const from=Math.max(Date.parse(g.created_at),s.coverage_until? s.coverage_until-600000 : (first?.at??s.enabled_at));
   const until=now-15000;requireValue(from<until,'wait_for_search_index');
   requireValue(until-from<=6*86400000,'source_gap_requires_review');
   await db.prepare('UPDATE gate_external_sources SET scan_id=?,scan_expires_at=?,scan_from=?,scan_until=?,next_page=0,next_token=NULL WHERE gate_id=?').bind(crypto.randomUUID(),now+600000,from,until,id).run();
  }
  const current=(await readExternalSource(db,id))!;
  const phrase=g.claim_phrase.replace(/["\\]/g,'');
  return {gateId:id,epoch:current.epoch,scanId:current.scan_id,page:current.next_page,nextToken:current.next_token,expiresAt:current.scan_expires_at,query:`(conversation_id:${g.post_id} OR (@${g.brand_username} "${phrase}") OR (url:${g.post_id} "${phrase}")) -is:retweet`,startTime:new Date(current.scan_from!).toISOString(),endTime:new Date(current.scan_until!).toISOString(),tweetFields:['id','text','author_id','created_at','conversation_id','referenced_tweets','entities'],userFields:['id','username','created_at','protected','public_metrics'],expansions:['author_id'],instructions:'Use the connected X tool, preserve the complete provider data and pagination token. Do not infer facts or fetch through X Harness. Import every page, including an empty final page. Missing author fields must be obtained before importing; do not invent them.'};
 });requireValue(result,'campaign_busy');return result;
}
export interface ExternalPage {epoch:string;scanId:string;page:number;requestToken:string|null;nextToken:string|null;posts:ClaimPost[];authors:ClaimAuthor[]}
export function parseExternalPage(raw:unknown):ExternalPage {
 requireValue(raw && typeof raw==='object' && !Array.isArray(raw),'invalid_page');const v=raw as ExternalPage;
 requireValue(Object.keys(v).every(k=>['epoch','scanId','page','requestToken','nextToken','posts','authors'].includes(k)),'unexpected_field');
 requireValue(typeof v.epoch==='string' && /^[a-f0-9-]{36}$/.test(v.epoch) && typeof v.scanId==='string' && /^[a-f0-9-]{36}$/.test(v.scanId),'invalid_scan');
 requireValue(Number.isInteger(v.page) && v.page>=0 && v.page<100,'invalid_page_index');
 for(const t of [v.requestToken,v.nextToken])requireValue(t===null || typeof t==='string' && t.length>0 && t.length<=2048,'invalid_pagination');
 requireValue(Array.isArray(v.posts) && v.posts.length<=100 && Array.isArray(v.authors) && v.authors.length<=100,'invalid_page_size');
 const id=(x:unknown)=>typeof x==='string' && /^\d{1,25}$/.test(x);
 const date=(x:unknown)=>typeof x==='string' && x.length<=35 && Number.isFinite(Date.parse(x));
 for(const a of v.authors){
  requireValue(a && id(a.id) && typeof a.username==='string' && /^[A-Za-z0-9_]{1,15}$/.test(a.username) && date(a.created_at) && typeof a.protected==='boolean','incomplete_author');
  requireValue(Object.keys(a).every(k=>['id','username','created_at','protected','public_metrics'].includes(k)),'unexpected_author_field');
  if(a.public_metrics) requireValue(Number.isInteger(a.public_metrics.followers_count) && typeof a.public_metrics.followers_count==='number' && a.public_metrics.followers_count>=0,'invalid_author_metrics');
 }
 const authors=new Map(v.authors.map(a=>[a.id,a]));requireValue(authors.size===v.authors.length,'duplicate_author');
 for(const p of v.posts){
  requireValue(p && id(p.id) && id(p.author_id) && typeof p.text==='string' && p.text.length<=25000 && date(p.created_at) && authors.has(p.author_id),'incomplete_post');
  requireValue(Object.keys(p).every(k=>['id','text','author_id','created_at','conversation_id','referenced_tweets','entities'].includes(k)),'unexpected_post_field');
  requireValue(!p.conversation_id || id(p.conversation_id),'invalid_conversation');
  if(p.referenced_tweets)requireValue(Array.isArray(p.referenced_tweets) && p.referenced_tweets.length<=5 && p.referenced_tweets.every(r=>r && id(r.id) && ['retweeted','quoted','replied_to'].includes(r.type)),'invalid_references');
  if(p.entities){
   requireValue(typeof p.entities==='object','invalid_entities');
   if(p.entities.mentions) requireValue(Array.isArray(p.entities.mentions) && p.entities.mentions.length<=100 && p.entities.mentions.every(m=>m && typeof m.username==='string' && /^[A-Za-z0-9_]{1,15}$/.test(m.username)),'invalid_mentions');
   if(p.entities.urls)requireValue(Array.isArray(p.entities.urls) && p.entities.urls.length<=100 && p.entities.urls.every(u=>u && [u.url,u.expanded_url].every(x=>x===undefined || typeof x==='string' && x.length<=2048)),'invalid_urls');
  }
 }
 requireValue(new Set(v.posts.map(p=>p.id)).size===v.posts.length,'duplicate_post');
 return v;
}
export async function settleExternalGate(db:D1Database,g:ClaimGate,s:ExternalSource,owner:string,now:number) {
 if(!supportsExternalSource(g) || s.scan_id || !s.last_complete_at || now-(s.coverage_until??0)>120000 || !s.coverage_until)return {pending:0,retryAfterSec:0};
 const claims=(await db.prepare("SELECT * FROM claim_codes WHERE gate_id=? AND status='provisional' ORDER BY reply_created_at,LENGTH(reply_tweet_id),reply_tweet_id LIMIT 50").bind(g.id).all<ClaimCode>()).results;
 for(const claim of claims){
  if(!claim.matched_at || s.coverage_until<claim.matched_at+g.settle_sec*1000)break;
  const p=await db.prepare('SELECT * FROM gate_participants WHERE id=?').bind(claim.participant_id).first<GateParticipant>();if(!p || p.finalized_at)continue;
  await db.prepare("UPDATE gate_participants SET status='verified',x_user_id=?,x_username=?,verified_at=?,missing='[]',retry_at=NULL WHERE id=? AND finalized_at IS NULL").bind(claim.x_user_id,claim.x_username,now,p.id).run();
  await finalizeParticipant(db,g,{...p,status:'verified',x_user_id:claim.x_user_id,x_username:claim.x_username},owner,now);
 }
 return {pending:0,retryAfterSec:0};
}
export async function importExternalPage(db:D1Database,id:string,page:ExternalPage,now=Date.now()) {
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(page))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const result=await withGateLock(db,id,async(owner)=>{
  const g=await gate(db,id),s=await readExternalSource(db,id);
  requireValue(s?.enabled && s.epoch===page.epoch,'source_changed');requireValue(supportsExternalSource(g),'unsupported_conditions');
  requireValue(g.is_active && g.gate_state==='active','campaign_not_active');
  const receipt=await db.prepare('SELECT digest FROM gate_external_receipts WHERE scan_id=? AND page=? AND gate_id=?').bind(page.scanId,page.page,id).first<{digest:string}>();
  if(receipt){requireValue(receipt.digest===digest,'page_replay_conflict');await settleExternalGate(db,g,s,owner,now);return {accepted:true,replayed:true};}
  requireValue(s.scan_id===page.scanId && (s.scan_expires_at??0)>now,'scan_expired');
  requireValue(page.page===s.next_page && page.requestToken===s.next_token,'page_out_of_order');
  requireValue(page.nextToken===null || page.nextToken!==page.requestToken,'pagination_did_not_advance');
  requireValue(page.posts.every(p=>Date.parse(p.created_at)>=s.scan_from! && Date.parse(p.created_at)<=s.scan_until!),'post_outside_scan');
  await matchClaimPosts(db,g,page.posts,page.authors,now);
  // The matcher is idempotent. Commit the receipt with cursor movement atomically;
  // a crash before this batch replays only matching, never inventory reservation.
  await db.batch([
   db.prepare('INSERT INTO gate_external_receipts(scan_id,page,gate_id,digest,received_at) VALUES (?,?,?,?,?)').bind(page.scanId,page.page,id,digest,now),
   db.prepare('UPDATE gate_external_sources SET scan_id=?,scan_expires_at=?,next_page=?,next_token=?,last_complete_at=?,coverage_until=? WHERE gate_id=?').bind(page.nextToken?page.scanId:null,page.nextToken?s.scan_expires_at:null,page.page+1,page.nextToken,page.nextToken?s.last_complete_at:now,page.nextToken?s.coverage_until:s.scan_until,id),
   db.prepare("INSERT INTO gate_events(id,gate_id,type,at,meta) VALUES (?,?,'external_page_received',?,?)").bind(crypto.randomUUID(),id,now,JSON.stringify({scanId:page.scanId,page:page.page,posts:page.posts.length,complete:page.nextToken===null,source:'owner_connector_observations',independentlyVerified:false})),
  ]);
  await settleExternalGate(db,g,(await readExternalSource(db,id))!,owner,now);
  return {accepted:true,replayed:false};
 });requireValue(result,'campaign_busy');return result;
}
