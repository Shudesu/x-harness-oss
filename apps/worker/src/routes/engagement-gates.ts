import { encryptSecret } from '@x-harness/db';
import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import {
  createEngagementGate, getEngagementGates, getEngagementGateById,
  updateEngagementGate, deleteEngagementGate, getDeliveries, resolveToken,
} from '@x-harness/db';
import { requireRole } from '../middleware/auth.js';
import type { Env } from '../index.js';

const engagementGates = new Hono<Env>();

function serialize(row: any) {
  return {
    id: row.id,
    xAccountId: row.x_account_id,
    postId: row.post_id,
    triggerType: row.trigger_type,
    actionType: row.action_type,
    gateMode: row.gate_mode,
    canResume:row.gate_mode==='line_first'?row.gate_state==='active'&&!row.archived_at:row.action_type==='mention_post'&&row.trigger_type==='reply'&&!row.link,
    slug:row.slug,title:row.title,tier:row.tier,gateState:row.gate_state,pauseReason:row.pause_reason,
    deliveryMethod: row.delivery_method,
    replyTemplates: row.reply_templates ? JSON.parse(row.reply_templates) : [],
    template: row.template,
    link: row.link,
    isActive: !!row.is_active,
    lineHarnessUrl: row.line_harness_url,
    lineHarnessTag: row.line_harness_tag,
    lineHarnessScenarioId: row.line_harness_scenario_id,
    requireLike: !!row.require_like,
    requireRepost: !!row.require_repost,
    requireFollow: !!row.require_follow,
    replyKeyword: row.reply_keyword,
    lotteryEnabled: !!row.lottery_enabled,
    pollingStrategy: row.polling_strategy ?? 'manual',
    expiresAt: row.expires_at,
    nextPollAt: row.next_poll_at,
    apiCallsTotal: row.api_calls_total ?? 0,
    estimatedCost: '旧カウンタからは推計不可',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDelivery(row: any) {
  return {
    id: row.id,
    gateId: row.gate_id,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    deliveredPostId: row.delivered_post_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

engagementGates.post('/api/engagement-gates',c=>c.json({success:false,error:'Create a LINE-first campaign using /api/campaigns'},400));

engagementGates.get('/api/engagement-gates', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const gates = await getEngagementGates(c.env.DB, {
    ...(xAccountId ? { xAccountId } : {}),
  });
  return c.json({ success: true, data: gates.map(serialize) });
});

engagementGates.get('/api/engagement-gates/:id', async (c) => {
  const gate = await getEngagementGateById(c.env.DB, c.req.param('id'));
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: serialize(gate) });
});

engagementGates.put('/api/engagement-gates/:id', async (c) => {
  const body = await c.req.json();
  const existing=await getEngagementGateById(c.env.DB,c.req.param('id')) as (Awaited<ReturnType<typeof getEngagementGateById>> & {gate_mode?:string;gate_state?:string;archived_at?:number});
  if(existing&&existing.gate_mode!=='line_first'&&body.isActive===true){const action=body.actionType??existing.action_type,trigger=body.triggerType??existing.trigger_type,link=body.link!==undefined?body.link:existing.link;if(action==='dm'||action==='mention_post'&&(trigger!=='reply'||!!link))return c.json({success:false,error:'This legacy delivery needs migration to the LINE-first flow'},409);}
  if(existing?.gate_mode==='line_first'){
    if(Object.keys(body).some(key=>!['isActive','budgetUsd'].includes(key)))return c.json({success:false,error:'Campaign terms are immutable; create another campaign for different terms'},400);
    if(body.isActive!==undefined&&typeof body.isActive!=='boolean')return c.json({success:false,error:'Invalid active flag'},400);
    if(body.isActive&&(existing.archived_at||existing.gate_state!=='active'))return c.json({success:false,error:'This draft cannot be resumed; inspect its configuration and create a new campaign'},409);
    if(body.budgetUsd!==undefined){const denied=requireRole(c,'admin');if(denied)return denied;if(!Number.isFinite(body.budgetUsd)||body.budgetUsd<0||body.budgetUsd>100000)return c.json({success:false,error:'Invalid budget'},400);await c.env.DB.prepare('UPDATE engagement_gates SET budget_usd=? WHERE id=?').bind(body.budgetUsd,existing.id).run();}
    if(body.isActive!==undefined)await c.env.DB.prepare('UPDATE engagement_gates SET is_active=? WHERE id=?').bind(body.isActive?1:0,existing.id).run();
    return c.json({success:true,data:serialize(await getEngagementGateById(c.env.DB,existing.id))});
  }

  if(body.link && typeof body.template==='string' && !body.template.includes('{link}'))return c.json({success:false,error:'A link requires {link} in the template'},400);
  if(body.replyTemplates!==undefined&&(!Array.isArray(body.replyTemplates)||body.replyTemplates.length>10||body.replyTemplates.some((t:unknown)=>typeof t!=='string'||t.length>1000)))return c.json({success:false,error:'Invalid templates'},400);
  if(body.deliveryMethod && !['dm','reply_no_link','reply_with_link'].includes(body.deliveryMethod))return c.json({success:false,error:'Invalid delivery method'},400);
  if(['lineHarnessUrl','lineHarnessApiKey'].some(k=>body[k]!==undefined)) {
    if(c.get('staffRole')!=='admin') return c.json({success:false,error:'Admin required for LINE credentials'},403);
    if(body.lineHarnessUrl) {try{if(new URL(body.lineHarnessUrl).protocol!=='https:')throw new Error();}catch{return c.json({success:false,error:'HTTPS URL required'},400);}}
    if(body.lineHarnessApiKey)body.lineHarnessApiKey=await encryptSecret(body.lineHarnessApiKey,c.env.ENCRYPTION_KEY);
  }
  const gate = await updateEngagementGate(c.env.DB, c.req.param('id'), body);
  if(gate&&body.replyTemplates)await c.env.DB.prepare('UPDATE engagement_gates SET reply_templates=? WHERE id=?').bind(JSON.stringify(body.replyTemplates),gate.id).run();
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  if(body.deliveryMethod) { if(!['dm','reply_no_link','reply_with_link'].includes(body.deliveryMethod)) return c.json({success:false,error:'Invalid delivery method'},400); await c.env.DB.prepare('UPDATE engagement_gates SET delivery_method=? WHERE id=?').bind(body.deliveryMethod,gate.id).run();gate.delivery_method=body.deliveryMethod; }
  return c.json({ success: true, data: serialize(gate) });
});

engagementGates.delete('/api/engagement-gates/:id', async (c) => {
  await deleteEngagementGate(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

engagementGates.get('/api/engagement-gates/:id/deliveries', async (c) => {
  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');
  const deliveries = await getDeliveries(c.env.DB, c.req.param('id'), { limit, offset });
  return c.json({ success: true, data: deliveries.map(serializeDelivery) });
});

// Delivery stats summary — consumed by the dashboard and the MCP
// get_gate_analytics tool.
engagementGates.get('/api/engagement-gates/:id/analytics', async (c) => {
  const gateId = c.req.param('id');
  const gate = await getEngagementGateById(c.env.DB, gateId);
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);

  const byStatusRows = await c.env.DB
    .prepare('SELECT status, COUNT(*) as count FROM engagement_gate_deliveries WHERE gate_id = ? GROUP BY status')
    .bind(gateId)
    .all<{ status: string; count: number }>();

  const byDateRows = await c.env.DB
    .prepare(`SELECT substr(created_at, 1, 10) as date, COUNT(*) as count
              FROM engagement_gate_deliveries WHERE gate_id = ?
              GROUP BY substr(created_at, 1, 10) ORDER BY date DESC LIMIT 90`)
    .bind(gateId)
    .all<{ date: string; count: number }>();

  const range = await c.env.DB
    .prepare('SELECT MIN(created_at) as first, MAX(created_at) as last, COUNT(*) as total FROM engagement_gate_deliveries WHERE gate_id = ?')
    .bind(gateId)
    .first<{ first: string | null; last: string | null; total: number }>();

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows.results) byStatus[r.status] = r.count;

  return c.json({
    success: true,
    data: {
      gateId,
      totalDeliveries: range?.total ?? 0,
      byStatus,
      byDate: byDateRows.results,
      firstDeliveryAt: range?.first ?? null,
      lastDeliveryAt: range?.last ?? null,
      apiCallsTotal: (gate as any).api_calls_total ?? 0,
    },
  });
});

// Debug: manually trigger engagement gate processing
engagementGates.post('/api/engagement-gates/process', async (c) => {
  const { XClient } = await import('@x-harness/x-sdk');
  const { getXAccounts } = await import('@x-harness/db');
  const { processEngagementGates } = await import('../services/engagement-gate.js');
  const accounts = await getXAccounts(c.env.DB);
  const results: any[] = [];
  for (const account of accounts) {
    try {
      const xClient = await buildXClient(c.env, account, 'engagement-gates');
      await processEngagementGates(c.env.DB, xClient, account.id, true, undefined, c.env.ENCRYPTION_KEY);
      results.push({ account: account.username, status: 'ok' });
    } catch (err: any) {
      results.push({ account: account.username, status: 'error', error: err.message });
    }
  }
  return c.json({ success: true, results });
});

// Public endpoint — no auth required (token is the secret)
engagementGates.on(['GET','POST'],'/api/tokens/:token/resolve', async (c) => {
  const result = await resolveToken(c.env.DB, c.req.param('token'));
  if (!result) return c.json({ success: false, error: 'Token invalid or already consumed' }, 404);
  return c.json({ success: true, data: result });
});

export { engagementGates };
