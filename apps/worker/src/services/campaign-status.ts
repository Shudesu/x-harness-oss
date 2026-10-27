import type { ClaimGate } from './claim-types.js';

/** Public counts only; never return participant identities or reward values. */
export async function getCampaignInventory(db: D1Database, gateId: string) {
  const row = await db
    .prepare(
      `SELECT
    COALESCE(SUM(CASE WHEN is_consolation=0 THEN MAX(0,quota-issued) ELSE 0 END),0) remaining,
    COALESCE(MAX(CASE WHEN is_consolation=0 AND quota IS NULL THEN 1 ELSE 0 END),0) unlimited,
    COALESCE(MAX(is_consolation),0) consolation FROM gate_rewards WHERE gate_id=?`,
    )
    .bind(gateId)
    .first<{ remaining: number; unlimited: number; consolation: number }>();
  return {
    remaining: row?.unlimited ? null : (row?.remaining ?? 0),
    unlimited: !!row?.unlimited,
    consolation: !!row?.consolation,
  };
}
export function publicParticipantCount(count: number) {
  return count < 10 ? null : count < 100 ? count : Math.floor(count / 10) * 10;
}
export async function getPublicCampaignStatus(db: D1Database, gate: ClaimGate, now = Date.now()) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) participants,
    COALESCE(SUM(CASE WHEN status IN ('provisional','verified','finalized','won','lost') THEN 1 ELSE 0 END),0) posted
    FROM gate_participants WHERE gate_id=?`,
    )
    .bind(gate.id)
    .first<{ participants: number; posted: number }>();
  return {
    ...(await getCampaignInventory(db, gate.id)),
    participants: publicParticipantCount(row?.participants ?? 0),
    posted: row?.posted ?? 0,
    endsAt: gate.ends_at,
    state:
      gate.archived_at || Date.parse(gate.ends_at) <= now || gate.gate_state === 'ended'
        ? 'ended'
        : gate.is_active && gate.gate_state === 'active'
          ? 'active'
          : 'paused',
    updatedAt: now,
  };
}
