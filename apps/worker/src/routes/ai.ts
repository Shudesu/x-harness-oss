import { Hono } from 'hono';
import { getXAccountById, getMonthSpend } from '@x-harness/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/auth.js';
import { runAiFeature } from '../services/ai-features.js';
import { isGrokEnabled } from '../services/grok.js';
const ai=new Hono<Env>();
ai.get('/api/ai/capabilities',async c=>{
  const rows=(await c.env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('xai_model','xai_monthly_budget_usd')").all<{key:string;value:string}>()).results;
  const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
  return c.json({success:true,data:{enabled:isGrokEnabled(c.env),model:settings.xai_model ?? c.env.XAI_MODEL ?? 'grok-4.3',monthlyBudgetUsd:Number(settings.xai_monthly_budget_usd ?? c.env.XAI_MONTHLY_BUDGET_USD ?? 5),spentThisMonthUsd:await getMonthSpend(c.env.DB,'xai')}});
});
ai.post('/api/ai/:feature',async c=>{
  const denied=requireRole(c,'admin','editor');if(denied)return denied;
  const feature=c.req.param('feature');if(!['digest','triage','drafts','research','best-times'].includes(feature))return c.json({success:false,error:'Not found'},404);
  const body=await c.req.json();
  if(typeof body.xAccountId!=='string'||!await getXAccountById(c.env.DB,body.xAccountId))return c.json({success:false,error:'Valid xAccountId required'},400);
  if(body.handles!==undefined&&(!Array.isArray(body.handles)||body.handles.length>20||body.handles.some((h:unknown)=>typeof h!=='string'||!/^[A-Za-z0-9_]{1,15}$/.test(h))))return c.json({success:false,error:'Invalid handles'},400);
  if(body.keywords!==undefined&&(!Array.isArray(body.keywords)||body.keywords.length>10||body.keywords.some((h:unknown)=>typeof h!=='string'||h.length>100)))return c.json({success:false,error:'Invalid keywords'},400);
  if(body.days!==undefined&&(!Number.isInteger(body.days)||body.days<1||body.days>30))return c.json({success:false,error:'Invalid days'},400);
  if(feature==='triage'&&(!Array.isArray(body.tweetIds)||body.tweetIds.length>100||body.tweetIds.some((id:unknown)=>typeof id!=='string'||!/^\d+$/.test(id))))return c.json({success:false,error:'Invalid tweetIds'},400);
  if(body.theme!==undefined&&(typeof body.theme!=='string'||body.theme.length>2000))return c.json({success:false,error:'Invalid theme'},400);
  if(feature==='research'&&!body.handles?.length&&!body.keywords?.length)return c.json({success:false,error:'Handles or keywords required'},400);
  if(feature==='drafts' && (typeof body.theme!=='string'||!body.theme.trim()))return c.json({success:false,error:'Theme required'},400);
  const data=await runAiFeature(c.env,body.xAccountId,feature as any,body);
  return c.json({success:true,data});
});
export {ai};
