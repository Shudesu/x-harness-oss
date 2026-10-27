import { decryptSecret } from '@x-harness/db';
import type { Env } from '../index.js';
import type { GateLineConnection } from './claim-types.js';
import { signHarnessRequest, assertHttpsBase, RETRY_DELAYS_MS } from './harness-gate-protocol.js';
export function outboxStatement(
  db: D1Database,
  gateId: string,
  participantId: string,
  event: string,
  payload: unknown,
  now = Date.now(),
) {
  return db
    .prepare(
      'INSERT OR IGNORE INTO event_outbox(id,gate_id,participant_id,event,payload,next_at,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), gateId, participantId, event, JSON.stringify(payload), now, now);
}
export async function sendLineOutbox(env: Env['Bindings'], now = Date.now()): Promise<void> {
  const items = (
    await env.DB.prepare(
      "SELECT * FROM event_outbox WHERE status='pending' AND next_at<=? AND (locked_until IS NULL OR locked_until<?) ORDER BY created_at,id LIMIT 25",
    )
      .bind(now, now)
      .all<{ id: string; gate_id: string; event: string; payload: string; attempts: number }>()
  ).results;
  for (const item of items) {
    const owner = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      "UPDATE event_outbox SET lock_owner=?,locked_until=? WHERE id=? AND status='pending' AND (locked_until IS NULL OR locked_until<?) RETURNING id",
    )
      .bind(owner, now + 60000, item.id, now)
      .first();
    if (!claimed) continue;
    try {
      const connection = await env.DB.prepare(
        'SELECT c.* FROM line_connections c JOIN engagement_gates g ON g.line_connection_id=c.id WHERE g.id=?',
      )
        .bind(item.gate_id)
        .first<GateLineConnection>();
      if (!connection?.integration_secret) throw new Error('integration_not_configured');
      const path =
        item.event === 'x.gate.cancel'
          ? `/api/integrations/x-harness/campaigns/${item.gate_id}/cancel`
          : '/api/integrations/x-harness/events';
      const headers = await signHarnessRequest(
        await decryptSecret(connection.integration_secret, env.ENCRYPTION_KEY),
        'POST',
        path,
        item.payload,
        { connectionId: connection.id, event: item.event, deliveryId: item.id },
      );
      if (item.event === 'x.gate.cancel')
        headers.Authorization = `Bearer ${await decryptSecret(connection.api_key, env.ENCRYPTION_KEY)}`;
      const response = await fetch(assertHttpsBase(connection.worker_url) + path, {
        method: 'POST',
        headers,
        body: item.payload,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`partner_http_${response.status}`);
      const acknowledgment = (await response.json()) as { success?: boolean };
      if (acknowledgment.success !== true) throw new Error('partner_acknowledgment_missing');
      await env.DB.prepare(
        "UPDATE event_outbox SET status='delivered',lock_owner=NULL,locked_until=NULL,last_error=NULL WHERE id=? AND lock_owner=?",
      )
        .bind(item.id, owner)
        .run();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[item.attempts];
      await env.DB.prepare(
        'UPDATE event_outbox SET attempts=attempts+1,next_at=?,last_error=?,status=?,lock_owner=NULL,locked_until=NULL WHERE id=? AND lock_owner=?',
      )
        .bind(
          now + (delay ?? 0),
          error instanceof Error ? error.message.slice(0, 120) : 'delivery_failed',
          delay === undefined ? 'dead' : 'pending',
          item.id,
          owner,
        )
        .run();
    }
  }
}
