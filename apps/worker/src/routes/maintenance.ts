import { Hono } from 'hono';
import { encryptSecret,hashApiKey } from '@x-harness/db';
import { requireRole } from '../middleware/auth.js';
import type { Env } from '../index.js';
const maintenance=new Hono<Env>();
const columns:Record<string,string[]>={x_accounts:['access_token','refresh_token','consumer_secret','access_token_secret','oauth_client_secret'],line_connections:['api_key'],engagement_gates:['line_harness_api_key']};
maintenance.all('/api/maintenance/secrets',async c=>{
 const denied=requireRole(c,'admin');if(denied)return denied;
 if(!['GET','POST'].includes(c.req.method))return c.json({success:false,error:'Method not allowed'},405);
 const apply=c.req.method==='POST';if(apply&&!c.env.ENCRYPTION_KEY)return c.json({success:false,error:'ENCRYPTION_KEY required'},400);
 const counts:Record<string,number>={};
 for(const [table,fields] of Object.entries(columns))for(const field of fields){
   const predicate=`${field} IS NOT NULL AND ${field} != '' AND ${field} NOT LIKE 'enc:%'`;
   counts[`${table}.${field}`]=(await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${predicate}`).first<{total:number}>())?.total ?? 0;
   if(apply){const rows=(await c.env.DB.prepare(`SELECT id,${field} AS secret FROM ${table} WHERE ${predicate} LIMIT 100`).all<{id:string;secret:string}>()).results;
     for(const row of rows)await c.env.DB.prepare(`UPDATE ${table} SET ${field}=? WHERE id=? AND ${field}=?`).bind(await encryptSecret(row.secret,c.env.ENCRYPTION_KEY),row.id,row.secret).run();}
 }
 counts['staff_members.api_key']=(await c.env.DB.prepare('SELECT COUNT(*) AS total FROM staff_members WHERE api_key_hash IS NULL').first<{total:number}>())?.total ?? 0;
 if(apply){const staff=(await c.env.DB.prepare('SELECT id,api_key FROM staff_members WHERE api_key_hash IS NULL LIMIT 100').all<{id:string;api_key:string}>()).results;for(const row of staff)await c.env.DB.prepare('UPDATE staff_members SET api_key_hash=?,api_key=? WHERE id=? AND api_key_hash IS NULL').bind(await hashApiKey(row.api_key),`revoked:${row.id}`,row.id).run();}
 return c.json({success:true,data:{apply,pendingBefore:counts,batchLimit:100}});
});
export {maintenance};
