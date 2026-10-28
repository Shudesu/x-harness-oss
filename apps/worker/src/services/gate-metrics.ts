import type { Env } from '../index.js';
import { getXAccountById } from '@x-harness/db';
import { buildXClient } from './x-client.js';
import { recordGateEvent } from './claim-codes.js';
export async function captureClosedGateMetrics(env: Env['Bindings']) {
  const rows = (
    await env.DB.prepare(
      "SELECT g.id,g.x_account_id,g.post_id FROM engagement_gates g WHERE NOT EXISTS(SELECT 1 FROM gate_external_sources es WHERE es.gate_id=g.id AND es.enabled=1) AND g.gate_mode='line_first' AND g.gate_state IN ('active','ended') AND g.archived_at IS NULL AND g.is_active=1 AND NOT EXISTS(SELECT 1 FROM gate_metric_jobs j WHERE j.gate_id=g.id AND j.next_at>CAST(strftime('%s','now') AS INTEGER)*1000) AND julianday(g.ends_at)<=julianday('now') AND NOT EXISTS(SELECT 1 FROM gate_events e WHERE e.dedup_key='closed-metrics:'||g.id) ORDER BY g.ends_at LIMIT 5",
    ).all<{ id: string; x_account_id: string; post_id: string }>()
  ).results;
  for (const gate of rows) {
    try {
      const account = await getXAccountById(env.DB, gate.x_account_id);
      if (!account) continue;
      const client = await buildXClient(env, account, `claim:${gate.id}`);
      const post = await client.getTweet(gate.post_id);
      await recordGateEvent(
        env.DB,
        gate.id,
        'impressions',
        null,
        { value: post.public_metrics?.impression_count ?? null },
        `closed-metrics:${gate.id}`,
      );
    } catch (error) {
      await env.DB.prepare(
        'INSERT INTO gate_metric_jobs(gate_id,next_at,attempts,last_error) VALUES (?,?,1,?) ON CONFLICT(gate_id) DO UPDATE SET next_at=excluded.next_at,attempts=attempts+1,last_error=excluded.last_error',
      )
        .bind(
          gate.id,
          Date.now() + 15 * 60000,
          error instanceof Error ? error.name : 'metrics_unavailable',
        )
        .run();
    }
  }
}
