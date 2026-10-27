import type { ClaimGate, GateParticipant } from './claim-types.js';
import { withGateLock } from './gate-rewards.js';
export interface Followup {
  enabled: boolean;
  offer: 'coupon' | 'early_notice' | 'both';
  couponRewardId?: string;
  couponRewardIndex?: number;
  label?: string;
}
export function readFollowup(gate: Pick<ClaimGate, 'loser_followup'>): Followup | null {
  try {
    const v = JSON.parse(gate.loser_followup ?? 'null');
    return v?.enabled ? v : null;
  } catch {
    return null;
  }
}
export function validFollowup(value: unknown, rewards: any[]): boolean {
  if (value === undefined || value === null) return true;
  const f = value as Followup;
  if (
    typeof f !== 'object' ||
    Array.isArray(f) ||
    typeof f.enabled !== 'boolean' ||
    !['coupon', 'early_notice', 'both'].includes(f.offer) ||
    (f.label !== undefined &&
      (typeof f.label !== 'string' || !f.label.trim() || f.label.length > 40))
  )
    return false;
  if (!f.enabled || f.offer === 'early_notice') return true;
  const reward =
    f.couponRewardIndex !== undefined && Number.isInteger(f.couponRewardIndex)
      ? rewards[f.couponRewardIndex]
      : rewards.find((r) => r.id && r.id === f.couponRewardId);
  return !!reward?.consolation && ['coupon_code', 'url'].includes(reward.type);
}
export async function optInFollowup(
  db: D1Database,
  gate: ClaimGate,
  participant: GateParticipant,
  now = Date.now(),
) {
  const config = readFollowup(gate);
  if (!config || participant.outcome !== 'lost' || !participant.finalized_at)
    throw new Error('followup_not_available');
  const result = await withGateLock(db, gate.id, async () => {
    const previous = await db
      .prepare('SELECT id FROM gate_events WHERE dedup_key=?')
      .bind(`followup:${gate.id}:${participant.id}`)
      .first();
    const allocation = () =>
      db
        .prepare(
          'SELECT a.value,r.label,r.type FROM gate_followup_allocations a JOIN gate_rewards r ON r.id=a.reward_id WHERE a.participant_id=?',
        )
        .bind(participant.id)
        .first<{ label: string; value: string; type: string }>();
    if (previous) return { coupon: await allocation(), offer: config.offer };
    const event = db
      .prepare(
        "INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key,meta) VALUES (?,?,?,'followup_opt_in',?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        gate.id,
        participant.id,
        now,
        `followup:${gate.id}:${participant.id}`,
        JSON.stringify({ offer: config.offer }),
      );
    if (config.offer !== 'early_notice' && config.couponRewardId) {
      try {
        await db.batch([
          event,
          db
            .prepare(
              'INSERT INTO gate_followup_allocations(participant_id,gate_id,reward_id,value,created_at) SELECT ?,?,?,value_template,? FROM gate_rewards WHERE id=?',
            )
            .bind(participant.id, gate.id, config.couponRewardId, now, config.couponRewardId),
          db
            .prepare(
              "INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,'followup_coupon',?,?)",
            )
            .bind(
              crypto.randomUUID(),
              gate.id,
              participant.id,
              now,
              `followup-coupon:${participant.id}`,
            ),
        ]);
      } catch (e) {
        if (!(e instanceof Error) || !e.message.includes('reward_exhausted')) throw e;
        await event.run();
      }
    } else await event.run();
    return { coupon: await allocation(), offer: config.offer };
  });
  if (!result) throw new Error('followup_busy');
  return result;
}
export async function earlyNoticeAudience(
  db: D1Database,
  ids: unknown,
  xAccountId: string,
  connectionId: string,
) {
  if (
    !Array.isArray(ids) ||
    ids.length > 5 ||
    ids.some((id) => typeof id !== 'string' || id.length > 128) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Invalid source gates');
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const gates = (
    await db
      .prepare(
        `SELECT id FROM engagement_gates WHERE id IN (${placeholders}) AND x_account_id=? AND line_connection_id=? AND gate_mode='line_first'`,
      )
      .bind(...ids, xAccountId, connectionId)
      .all()
  ).results;
  if (gates.length !== ids.length) throw new Error('Source gate account mismatch');
  return (
    (
      await db
        .prepare(
          `SELECT COUNT(DISTINCT p.line_friend_id) n FROM gate_events e JOIN gate_participants p ON p.id=e.participant_id WHERE e.gate_id IN (${placeholders}) AND e.type='followup_opt_in' AND json_extract(e.meta,'$.offer') IN ('early_notice','both')`,
        )
        .bind(...ids)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}
