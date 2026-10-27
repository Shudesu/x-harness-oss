import { buildCampaignSummary } from '../services/campaign-summary.js';
import { requireRole } from '../middleware/auth.js';
import { decryptSecret } from '@x-harness/db';
import { signHarnessRequest, assertHttpsBase } from '../services/harness-gate-protocol.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
const gateFunnel = new Hono<Env>();
gateFunnel.get('/api/engagement-gates/:id/funnel', async (c) => {
  const gateId = c.req.param('id');
  const gate = await c.env.DB.prepare(
    'SELECT id,gate_mode,gate_state,pause_reason,tier,budget_usd,campaign_post_cost_usd,campaign_external_cost_usd FROM engagement_gates WHERE id=?',
  )
    .bind(gateId)
    .first();
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  let lineEngagement: number | null = null;
  const connection = await c.env.DB.prepare(
    'SELECT c.* FROM line_connections c JOIN engagement_gates g ON g.line_connection_id=c.id WHERE g.id=?',
  )
    .bind(gateId)
    .first<{ id: string; worker_url: string; integration_secret: string | null }>();
  if (connection?.integration_secret) {
    try {
      const path = '/api/integrations/x-harness/engagement?' + new URLSearchParams({ gateId });
      const headers = await signHarnessRequest(
        await decryptSecret(connection.integration_secret, c.env.ENCRYPTION_KEY),
        'GET',
        path,
        '',
        { connectionId: connection.id, event: 'x.gate.analytics' },
      );
      const response = await fetch(assertHttpsBase(connection.worker_url) + path, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const result = (await response.json()) as { data?: { engaged?: number } };
        lineEngagement = typeof result.data?.engaged === 'number' ? result.data.engaged : null;
      }
    } catch {}
  }
  const data = await buildCampaignSummary(c.env.DB, gateId, lineEngagement);
  return c.json({ success: true, data });
});
gateFunnel.get('/api/engagement-gates/:id/outbox', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return denied;
  const rows = (
    await c.env.DB.prepare(
      "SELECT id,event,attempts,last_error,created_at FROM event_outbox WHERE gate_id=? AND status='dead' ORDER BY created_at DESC LIMIT 100",
    )
      .bind(c.req.param('id'))
      .all<{
        id: string;
        event: string;
        attempts: number;
        last_error: string;
        created_at: number;
      }>()
  ).results;
  return c.json({
    success: true,
    data: rows.map((r) => ({ ...r, canRetry: Date.now() - r.created_at < 23 * 3600000 })),
  });
});
gateFunnel.post('/api/engagement-gates/:id/outbox/:deliveryId/retry', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return denied;
  const row = await c.env.DB.prepare(
    "UPDATE event_outbox SET status='pending',next_at=?,locked_until=NULL,lock_owner=NULL WHERE gate_id=? AND id=? AND status='dead' AND created_at>? RETURNING id",
  )
    .bind(Date.now(), c.req.param('id'), c.req.param('deliveryId'), Date.now() - 23 * 3600000)
    .first();
  if (!row)
    return c.json(
      {
        success: false,
        error: 'Reconcile the delivery before retrying; provider deduplication may have expired',
      },
      409,
    );
  return c.json({ success: true });
});
export { gateFunnel };
