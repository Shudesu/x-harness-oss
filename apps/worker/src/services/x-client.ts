import { XClient, type UsageEvent, type RequestMeta } from '@x-harness/x-sdk';
import { decryptSecret, encryptSecret, recordSpend, getMonthSpend, UNIT_PRICES, type DbXAccount } from '@x-harness/db';
import type { Env } from '../index.js';
export class BudgetExceededError extends Error { constructor(){super('X API budget reached');this.name='BudgetExceededError';} }
export function classifyUsage(u:UsageEvent):Array<{resourceType:string;units:number}> {
  const endpoint=u.endpoint;
  if(u.method !== 'GET') {
    const text=JSON.stringify(u.body ?? {});
    const resourceType=u.method==='DELETE'?'delete':endpoint==='/tweets'?(/https?:\/\//i.test(text)?'post_create_url':'post_create') : endpoint.includes('dm_conversations')?'dm_create':endpoint.includes('media')?'media':'interaction_create';
    return [{resourceType,units:1}];
  }
  const body=u.data as {data?:unknown;includes?:Record<string,unknown[]>};
  const resourceType=endpoint.includes('liking_users')?'likes_read':/\/(followers|following)$/.test(endpoint)?'follows_read':endpoint.includes('dm_events')?'dm_read':/\/(tweets|mentions|quote_tweets|bookmarks|liked_tweets)(\/|$)/.test(endpoint)?'post_read':endpoint.includes('/news')?'news_read':'user_read';
  const result=[{resourceType,units:Array.isArray(body.data)?body.data.length:body.data?1:0}];
  for(const [kind,values] of Object.entries(body.includes ?? {})) if(['users','tweets'].includes(kind)) result.push({resourceType:kind==='users'?'user_read':'post_read',units:values.length});
  return result;
}
export async function buildXClient(env:Env['Bindings'], account:DbXAccount, feature='manual'):Promise<XClient> {
  const secret=async (value:string|null|undefined)=>value?decryptSecret(value,env.ENCRYPTION_KEY):'';
  const settings=(await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('x_monthly_budget_usd','scheduled_posts_ignore_budget','x_unit_prices','x_owned_reads')").all<{key:string;value:string}>()).results;
  const config=Object.fromEntries(settings.map(r=>[r.key,r.value]));
  let prices={...UNIT_PRICES};
  if(config.x_unit_prices) { try { const custom=JSON.parse(config.x_unit_prices); for(const [k,v] of Object.entries(custom)) if(k in prices && typeof v==='number' && Number.isFinite(v) && v>=0) prices[k]=v; } catch { throw new Error('Invalid pricing settings'); } }
  const refresh=async ():Promise<string>=>{
    // A rotating refresh token must not be used concurrently by separate cron/HTTP jobs.
    const lock=await env.DB.prepare("INSERT INTO ai_locks(id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at < ? RETURNING id").bind(`oauth:${account.id}`,Date.now()+60000,Date.now()).first();
    if(!lock) throw new Error('Account refresh in progress; retry shortly');
    try {
      const fresh=await env.DB.prepare('SELECT * FROM x_accounts WHERE id = ?').bind(account.id).first<DbXAccount>();
      if(!fresh?.refresh_token || !fresh.oauth_client_id) throw new Error('OAuth reconnect required');
      if(fresh.access_token !== account.access_token && fresh.token_expires_at && fresh.token_expires_at>Date.now()+300000) return secret(fresh.access_token);
      const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
      if(fresh.oauth_client_secret) headers.Authorization=`Basic ${btoa(`${fresh.oauth_client_id}:${await secret(fresh.oauth_client_secret)}`)}`;
      const response=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers,body:new URLSearchParams({grant_type:'refresh_token',refresh_token:await secret(fresh.refresh_token),client_id:fresh.oauth_client_id}),signal:AbortSignal.timeout(30000)});
      if(!response.ok) { if([400,401].includes(response.status)) await env.DB.prepare('UPDATE x_accounts SET needs_reauth=1 WHERE id=?').bind(account.id).run(); throw new Error('OAuth refresh failed; reconnect account'); }
      const data=await response.json() as {access_token:string;refresh_token?:string;expires_in:number};
      if(!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid OAuth token response');
      await env.DB.prepare('UPDATE x_accounts SET access_token=?,refresh_token=?,token_expires_at=?,needs_reauth=0 WHERE id=?').bind(await encryptSecret(data.access_token,env.ENCRYPTION_KEY),await encryptSecret(data.refresh_token ?? await secret(fresh.refresh_token),env.ENCRYPTION_KEY),Date.now()+data.expires_in*1000,account.id).run();
      return data.access_token;
    } finally { await env.DB.prepare('DELETE FROM ai_locks WHERE id=?').bind(`oauth:${account.id}`).run(); }
  };
  const oauth1=!!(account.consumer_key && account.consumer_secret && account.access_token_secret);
  const token=(!oauth1 && account.token_expires_at && account.token_expires_at < Date.now()+300000)?await refresh():await secret(account.access_token);
  return new XClient(oauth1?{type:'oauth1',consumerKey:account.consumer_key!,consumerSecret:await secret(account.consumer_secret),accessToken:token,accessTokenSecret:await secret(account.access_token_secret)}:token,{
    refreshToken:!oauth1?refresh:undefined,
    beforeRequest:async (_meta:RequestMeta)=>{
      if(feature==='scheduled' && config.scheduled_posts_ignore_budget==='true') return;
      const budget=Number(config.x_monthly_budget_usd ?? 50);
      if(!Number.isFinite(budget) || budget<0) throw new Error('Invalid X budget');
      if(await getMonthSpend(env.DB)>=budget) {
        await env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES ('budget_paused_at',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(new Date().toISOString(),new Date().toISOString()).run();
        throw new BudgetExceededError();
      }
    },
    onUsage:async u=>{
      for(const item of classifyUsage(u)) {
        if(!item.units) continue;
        const owned=config.x_owned_reads==='true' && u.method==='GET' && u.endpoint.startsWith(`/users/${account.x_user_id}/`) && /\/(tweets|mentions|followers|following|bookmarks|liked_tweets)$/.test(u.endpoint);
        const resourceType=owned?'owned_read':item.resourceType;
        await recordSpend(env.DB,{accountId:account.id,feature,endpoint:u.endpoint,resourceType,units:item.units,unitCost:prices[resourceType]});
      }
      if(u.method==='GET' && /\/(tweets|mentions)$/.test(u.endpoint)) {
        const data=(u.data as {data?:Array<{id:string}>}).data;
        if(Array.isArray(data)) for(const post of data) await env.DB.prepare('INSERT INTO post_cache(x_account_id,id,kind,json,fetched_at) VALUES (?,?,?,?,?) ON CONFLICT(x_account_id,id,kind) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at').bind(account.id,post.id,u.endpoint.endsWith('/mentions')?'mention':'post',JSON.stringify(post),Date.now()).run();
      }
    }
  });
}
