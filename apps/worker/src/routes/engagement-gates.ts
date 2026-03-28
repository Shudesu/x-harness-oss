import { Hono } from 'hono';
import {
  createEngagementGate, getEngagementGates, getEngagementGateById,
  updateEngagementGate, deleteEngagementGate, getDeliveries, resolveToken,
} from '@x-harness/db';
import type { Env } from '../index.js';

const engagementGates = new Hono<Env>();

function serialize(row: any) {
  return {
    id: row.id,
    xAccountId: row.x_account_id,
    postId: row.post_id,
    triggerType: row.trigger_type,
    actionType: row.action_type,
    template: row.template,
    link: row.link,
    isActive: !!row.is_active,
    lineHarnessUrl: row.line_harness_url,
    lineHarnessApiKey: row.line_harness_api_key,
    lineHarnessTag: row.line_harness_tag,
    lineHarnessScenarioId: row.line_harness_scenario_id,
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

engagementGates.post('/api/engagement-gates', async (c) => {
  const body = await c.req.json();
  if (!body.xAccountId || !body.postId || !body.triggerType || !body.actionType || !body.template) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, postId, triggerType, actionType, template' }, 400);
  }
  const gate = await createEngagementGate(c.env.DB, body);
  return c.json({ success: true, data: serialize(gate) }, 201);
});

engagementGates.get('/api/engagement-gates', async (c) => {
  const gates = await getEngagementGates(c.env.DB);
  return c.json({ success: true, data: gates.map(serialize) });
});

engagementGates.get('/api/engagement-gates/:id', async (c) => {
  const gate = await getEngagementGateById(c.env.DB, c.req.param('id'));
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: serialize(gate) });
});

engagementGates.put('/api/engagement-gates/:id', async (c) => {
  const body = await c.req.json();
  const gate = await updateEngagementGate(c.env.DB, c.req.param('id'), body);
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
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

// Debug: manually trigger engagement gate processing
engagementGates.post('/api/engagement-gates/process', async (c) => {
  const { XClient } = await import('@x-harness/x-sdk');
  const { getXAccounts } = await import('@x-harness/db');
  const { processEngagementGates } = await import('../services/engagement-gate.js');
  const accounts = await getXAccounts(c.env.DB);
  const results: any[] = [];
  for (const account of accounts) {
    try {
      const xClient = account.consumer_key && account.consumer_secret && account.access_token_secret
        ? new XClient({
            type: 'oauth1',
            consumerKey: account.consumer_key,
            consumerSecret: account.consumer_secret,
            accessToken: account.access_token,
            accessTokenSecret: account.access_token_secret,
          })
        : new XClient(account.access_token);
      await processEngagementGates(c.env.DB, xClient, account.id);
      results.push({ account: account.username, status: 'ok' });
    } catch (err: any) {
      results.push({ account: account.username, status: 'error', error: err.message });
    }
  }
  return c.json({ success: true, results });
});

// Public endpoint — no auth required (token is the secret)
engagementGates.get('/api/tokens/:token/resolve', async (c) => {
  const result = await resolveToken(c.env.DB, c.req.param('token'));
  if (!result) return c.json({ success: false, error: 'Token invalid or already consumed' }, 404);
  return c.json({ success: true, data: result });
});

export { engagementGates };
