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
  const stages = (
    await c.env.DB.prepare(
      'SELECT type,COUNT(DISTINCT COALESCE(participant_id,session_id,id)) AS count FROM gate_events WHERE gate_id=? GROUP BY type',
    )
      .bind(gateId)
      .all<{ type: string; count: number }>()
  ).results;
  const counts = Object.fromEntries(stages.map((r) => [r.type, r.count]));
  const apiCost =
    (
      await c.env.DB.prepare(
        "SELECT COALESCE(SUM(cost_usd),0) AS total FROM api_spend_ledger WHERE source='x' AND feature=?",
      )
        .bind(`claim:${gateId}`)
        .first<{ total: number }>()
    )?.total ?? 0;
  const rewards = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(r.unit_cost),0) AS total,SUM(CASE WHEN r.unit_cost IS NULL THEN 1 ELSE 0 END) AS unknown FROM gate_allocations a JOIN gate_rewards r ON r.id=a.reward_id WHERE a.gate_id=?',
  )
    .bind(gateId)
    .first<{ total: number; unknown: number }>();
  const dead =
    (
      await c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_outbox WHERE gate_id=? AND status='dead'",
      )
        .bind(gateId)
        .first<{ count: number }>()
    )?.count ?? 0;
  const pending =
    (
      await c.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM gate_participants WHERE gate_id=? AND finalized_at IS NULL',
      )
        .bind(gateId)
        .first<{ count: number }>()
    )?.count ?? 0;
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
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const result = (await response.json()) as { data?: { engaged?: number } };
        lineEngagement = typeof result.data?.engaged === 'number' ? result.data.engaged : null;
      }
    } catch {}
  }
  const impressions =
    (
      await c.env.DB.prepare(
        "SELECT json_extract(meta,'$.value') AS value FROM gate_events WHERE gate_id=? AND type='impressions' ORDER BY at DESC LIMIT 1",
      )
        .bind(gateId)
        .first<{ value: number | null }>()
    )?.value ?? null;
  const knownCosts = gate as {
    campaign_post_cost_usd: number | null;
    campaign_external_cost_usd: number | null;
  };
  const costsComplete =
    knownCosts.campaign_post_cost_usd !== null &&
    knownCosts.campaign_external_cost_usd !== null &&
    !rewards?.unknown;
  const sequence =
    (gate as { tier?: string }).tier === 'simple'
      ? ['impressions', 'view', 'line_added', 'verified', 'won', 'lost', 'line_engaged']
      : [
          'impressions',
          'view',
          'line_added',
          'code_issued',
          'reply_matched',
          'verified',
          'won',
          'lost',
          'line_engaged',
        ];
  const parent: Record<string, string> = {
    view: 'impressions',
    line_added: 'view',
    code_issued: 'view',
    reply_matched: 'code_issued',
    verified: 'reply_matched',
    won: 'verified',
    lost: 'verified',
    line_engaged: 'verified',
  };

  const stageValue = (type: string) =>
    type === 'impressions'
      ? impressions
      : type === 'line_engaged'
        ? lineEngagement
        : (counts[type] ?? 0);
  const stageRows = sequence.map((type) => {
    const count = stageValue(type),
      denominator = stageValue(parent[type] ?? '');
    return {
      type,
      count,
      conversion:
        count !== null && denominator !== null && denominator > 0 && count <= denominator
          ? count / denominator
          : null,
    };
  });
  const conditionRows = (
    await c.env.DB.prepare(
      'SELECT status,missing,COUNT(*) AS count FROM gate_participants WHERE gate_id=? AND finalized_at IS NULL GROUP BY status,missing',
    )
      .bind(gateId)
      .all<{ status: string; missing: string; count: number }>()
  ).results;
  const reasonCounts: Record<string, number> = {};
  for (const row of conditionRows) {
    const missing = JSON.parse(row.missing) as string[];
    for (const reason of missing.length ? missing : [row.status])
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + row.count;
  }
  return c.json({
    success: true,
    data: {
      gate,
      stages: stageRows,
      budgetUsd: (gate as { budget_usd: number }).budget_usd,
      conditionFailures: Object.entries(reasonCounts).map(([type, count]) => ({ type, count })),
      reasons: stages.filter((r) =>
        [
          'reply_without_code',
          'multiple_codes',
          'unknown_code',
          'expired',
          'account_too_new',
          'protected_account',
          'x_already_used',
          'wrong_campaign',
          'reply_deleted',
          'followers_count',
        ].includes(r.type),
      ),
      apiCostUsd: apiCost,
      rewardCostUsd: rewards?.unknown ? null : (rewards?.total ?? 0),
      lineAddCpaUsd:
        counts.line_added && costsComplete
          ? (apiCost +
              (rewards?.total ?? 0) +
              knownCosts.campaign_post_cost_usd! +
              knownCosts.campaign_external_cost_usd!) /
            counts.line_added
          : null,
      costNote:
        'API estimates plus known reward costs; external promotion/posting costs not included',
      deadLetters: dead,
      pending,
    },
  });
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
