import { Hono } from 'hono';
import { createXAccount, encryptSecret, decryptSecret } from '@x-harness/db';
import { requireRole } from '../middleware/auth.js';
import type { Env } from '../index.js';
const oauth=new Hono<Env>();
function b64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
oauth.post('/api/x/oauth/start',async c=>{
 const denied=requireRole(c,'admin');if(denied)return denied;
 if(!c.env.X_OAUTH_CLIENT_ID||!c.env.WORKER_URL||!c.env.ENCRYPTION_KEY)return c.json({success:false,error:'OAuth client and encryption key must be configured'},400);
 const state=b64(crypto.getRandomValues(new Uint8Array(32))),verifier=b64(crypto.getRandomValues(new Uint8Array(48)));
 const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 await c.env.DB.prepare('INSERT INTO oauth_states(state,verifier,expires_at) VALUES (?,?,?)').bind(state,await encryptSecret(verifier,c.env.ENCRYPTION_KEY),Date.now()+600000).run();
 const url=new URL('https://x.com/i/oauth2/authorize');url.search=new URLSearchParams({response_type:'code',client_id:c.env.X_OAUTH_CLIENT_ID,redirect_uri:`${c.env.WORKER_URL.replace(/\/$/,'')}/api/x/oauth/callback`,scope:'tweet.read tweet.write users.read follows.read like.read like.write dm.read dm.write media.write offline.access',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 c.header('Cache-Control','no-store');return c.json({success:true,data:{authorizationUrl:url.toString()}});
});
oauth.get('/api/x/oauth/callback',async c=>{
 const state=c.req.query('state'),code=c.req.query('code');if(!state||!code||!c.env.X_OAUTH_CLIENT_ID)return c.json({success:false,error:'Invalid OAuth callback'},400);
 const row=await c.env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING verifier').bind(state,Date.now()).first<{verifier:string}>();
 if(!row)return c.json({success:false,error:'OAuth state expired or used'},400);
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
 if(c.env.X_OAUTH_CLIENT_SECRET)headers.Authorization=`Basic ${btoa(`${c.env.X_OAUTH_CLIENT_ID}:${c.env.X_OAUTH_CLIENT_SECRET}`)}`;
 const response=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers,body:new URLSearchParams({grant_type:'authorization_code',code,client_id:c.env.X_OAUTH_CLIENT_ID,redirect_uri:`${c.env.WORKER_URL.replace(/\/$/,'')}/api/x/oauth/callback`,code_verifier:await decryptSecret(row.verifier,c.env.ENCRYPTION_KEY)}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)return c.json({success:false,error:'OAuth exchange failed; reconnect'},400);
 const tokens=await response.json() as {access_token:string;refresh_token?:string;expires_in:number};if(!tokens.access_token||!tokens.refresh_token||!Number.isFinite(tokens.expires_in))return c.json({success:false,error:'Offline authorization required'},400);
 const profileResponse=await fetch('https://api.x.com/2/users/me',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(10000)});
 if(!profileResponse.ok)return c.json({success:false,error:'Unable to validate account'},502);
 const {data:me}=await profileResponse.json() as {data:{id:string;username:string;name:string}};
 if(!me?.id||!me.username)return c.json({success:false,error:'Invalid account response'},502);
 const access=await encryptSecret(tokens.access_token,c.env.ENCRYPTION_KEY),refresh=await encryptSecret(tokens.refresh_token,c.env.ENCRYPTION_KEY);
 const existing=await c.env.DB.prepare('SELECT id FROM x_accounts WHERE x_user_id=?').bind(me.id).first<{id:string}>();
 const id=existing?.id ?? (await createXAccount(c.env.DB,{xUserId:me.id,username:me.username,displayName:me.name,accessToken:access,refreshToken:refresh})).id;
 await c.env.DB.prepare('UPDATE x_accounts SET access_token=?,refresh_token=?,token_expires_at=?,oauth_client_id=?,oauth_client_secret=?,consumer_key=NULL,consumer_secret=NULL,access_token_secret=NULL,needs_reauth=0,is_active=1 WHERE id=?').bind(access,refresh,Date.now()+tokens.expires_in*1000,c.env.X_OAUTH_CLIENT_ID,c.env.X_OAUTH_CLIENT_SECRET?await encryptSecret(c.env.X_OAUTH_CLIENT_SECRET,c.env.ENCRYPTION_KEY):null,id).run();
 c.header('Cache-Control','no-store');return c.json({success:true,message:'X account connected. Return to the dashboard.'});
});
export {oauth};
