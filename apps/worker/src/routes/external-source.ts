import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/auth.js';
import { ExternalSourceError,configureExternalSource,externalSourceStatus,startExternalScan,importExternalPage,parseExternalPage } from '../services/external-source.js';
const externalSource=new Hono<Env>();
externalSource.onError((error,c)=>c.json({success:false,error:error instanceof ExternalSourceError?error.message:'external_source_failed'},error instanceof ExternalSourceError?409:500));
externalSource.use('/api/integrations/agent-source/*',bodyLimit({maxSize:131072,onError:c=>c.json({success:false,error:'page_too_large'},413)}));
externalSource.use('/api/integrations/agent-source/*',async(c,next)=>{
 c.header('Cache-Control','no-store');const denied=requireRole(c,'admin');if(denied)return denied;
 try{await next();}catch(error){if(error instanceof ExternalSourceError)return c.json({success:false,error:error.message},409);throw error;}
});
externalSource.get('/api/integrations/agent-source/gates',async c=>{
 const rows=(await c.env.DB.prepare("SELECT id FROM engagement_gates WHERE gate_mode='line_first' AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 100").all<{id:string}>()).results;
 return c.json({success:true,data:{gates:await Promise.all(rows.map(r=>externalSourceStatus(c.env.DB,r.id))),limit:100}});
});
externalSource.get('/api/integrations/agent-source/:id/status',async c=>c.json({success:true,data:await externalSourceStatus(c.env.DB,c.req.param('id'))}));
externalSource.post('/api/integrations/agent-source/:id/mode',async c=>{
 const body=await c.req.json();if(typeof body?.enabled!=='boolean' || body.confirm!=='owner_accepts_external_observations')return c.json({success:false,error:'owner_consent_required'},400);
 return c.json({success:true,data:await configureExternalSource(c.env.DB,c.req.param('id'),body.enabled)});
});
externalSource.post('/api/integrations/agent-source/:id/scan',async c=>c.json({success:true,data:await startExternalScan(c.env.DB,c.req.param('id'))}));
externalSource.post('/api/integrations/agent-source/:id/page',async c=>{
 let page;try{page=parseExternalPage(await c.req.json());}catch{return c.json({success:false,error:'invalid_external_page'},400);}
 return c.json({success:true,data:await importExternalPage(c.env.DB,c.req.param('id'),page)});
});
export { externalSource };
