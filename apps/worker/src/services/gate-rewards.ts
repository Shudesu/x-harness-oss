import { readFollowup } from './campaign-followup.js';
import { getCampaignInventory } from './campaign-status.js';
import { campaignDisplay } from './campaign-display.js';
import type { ClaimGate, GateParticipant, GateReward, ClaimCode } from './claim-types.js';
import { outboxStatement } from './line-events.js';
export async function withGateLock<T>(
  db: D1Database,
  gateId: string,
  run: (owner: string) => Promise<T>,
): Promise<T | null> {
  const owner = crypto.randomUUID(),
    now = Date.now();
  const row = await db
    .prepare(
      'INSERT INTO gate_locks(gate_id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(gate_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<? RETURNING owner',
    )
    .bind(gateId, owner, now + 180000, now)
    .first();
  if (!row) return null;
  try {
    return await run(owner);
  } finally {
    await db
      .prepare('DELETE FROM gate_locks WHERE gate_id=? AND owner=?')
      .bind(gateId, owner)
      .run();
  }
}
function lotteryOrder(rewards: GateReward[]): GateReward[] {
  const regular = rewards.filter((r) => r.weight > 0);
  const total = regular.reduce((n, r) => n + r.weight, 0);
  let n = (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * total;
  const selected = regular.find((r) => {
    n -= r.weight;
    return n < 0;
  });
  // Weights describe relative winner tiers, not an unstated promise about odds.
  return [
    ...(selected ? [selected] : []),
    ...rewards.filter(
      (r) => selected && !selected.is_consolation && !r.is_consolation && r.tier > selected.tier,
    ),
    ...rewards.filter((r) => r.is_consolation),
  ];
}
export async function finalizeParticipant(
  db: D1Database,
  gate: ClaimGate,
  participant: GateParticipant,
  owner: string,
  now = Date.now(),
  forceLost = false,
): Promise<boolean> {
  if (participant.finalized_at) return true;
  const validLock = await db
    .prepare('SELECT owner FROM gate_locks WHERE gate_id=? AND owner=? AND expires_at>?')
    .bind(gate.id, owner, now)
    .first();
  if (!validLock) throw new Error('gate_lock_expired');
  const rewards = (
    await db
      .prepare('SELECT * FROM gate_rewards WHERE gate_id=? ORDER BY tier')
      .bind(gate.id)
      .all<GateReward>()
  ).results;
  const followup = readFollowup(gate);
  const distributionRewards = rewards.filter(
    (r) => r.id !== followup?.couponRewardId && (!forceLost || r.is_consolation),
  );
  const order =
    gate.award_mode === 'lottery' ? lotteryOrder(distributionRewards) : distributionRewards;
  const claim = await db
    .prepare("SELECT * FROM claim_codes WHERE participant_id=? AND status!='expired'")
    .bind(participant.id)
    .first<ClaimCode>();
  const rankRow = await db
    .prepare('SELECT COALESCE(MAX(rank),0)+1 AS rank FROM gate_participants WHERE gate_id=?')
    .bind(gate.id)
    .first<{ rank: number }>();
  const rank = rankRow?.rank ?? 1;
  for (const reward of [...order, null]) {
    const outcome = reward && !reward.is_consolation ? 'won' : 'lost';
    const base = {
      schema: 'xh.gate.v1',
      gateId: gate.id,
      participantId: participant.id,
      lineFriendId: participant.line_friend_id,
      xUserId: participant.x_user_id,
      xUsername: participant.x_username,
      replyTweetId: claim?.reply_tweet_id ?? null,
      replyCreatedAt: claim?.reply_created_at ?? null,
      rank,
      awardMode: gate.award_mode,
      title: gate.title,
      outcome,
    };
    const remaining =
      reward?.quota === null ? null : reward ? Math.max(0, reward.quota! - reward.issued - 1) : 0;
    const value =
      reward?.type === 'coupon_code'
        ? (
            await db
              .prepare(
                'SELECT code FROM reward_codes WHERE reward_id=? AND assigned_participant_id IS NULL ORDER BY id LIMIT 1',
              )
              .bind(reward.id)
              .first<{ code: string }>()
          )?.code
        : reward?.value_template;
    if (reward?.type === 'coupon_code' && !value) continue;
    const inventory = await getCampaignInventory(db, gate.id);
    const remainingTotal =
      inventory.remaining === null
        ? null
        : Math.max(0, inventory.remaining - (reward && !reward.is_consolation ? 1 : 0));
    const display = campaignDisplay({
      title: gate.title,
      awardMode: gate.award_mode,
      outcome,
      rank,
      remaining: remainingTotal,
      reward: reward?.label ?? null,
      templates: gate.message_templates,
    });
    if (forceLost && JSON.parse(participant.missing).length)
      display.message = '条件を確認できなかったため、次の方へ繰り上げました。';
    const payload = {
      display,
      ...(outcome === 'lost' && followup
        ? {
            followup: {
              offer: followup.offer,
              label:
                followup.label ??
                (followup.offer === 'coupon'
                  ? '参加賞クーポンを受け取る'
                  : followup.offer === 'both'
                    ? 'クーポンと次回のLINE案内を受け取る'
                    : '次回のキャンペーンをLINEで受け取る'),
            },
          }
        : {}),
      ...base,
      remaining,
      reward: reward ? { id: reward.id, label: reward.label, type: reward.type, value } : null,
      tags: [
        `x-gate:${gate.slug}`,
        `x-gate:${gate.slug}:${outcome}`,
        ...(outcome === 'lost' ? [`gate_lost:${gate.id}`] : []),
      ],
    };
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          'INSERT INTO gate_settlements(participant_id,gate_id,lock_owner,created_at) VALUES (?,?,?,?)',
        )
        .bind(participant.id, gate.id, owner, now),
    ];
    if (reward)
      statements.push(
        db
          .prepare(
            'INSERT INTO gate_allocations(participant_id,reward_id,gate_id,value,created_at) VALUES (?,?,?,?,?)',
          )
          .bind(participant.id, reward.id, gate.id, value ?? '', now),
      );
    statements.push(
      db
        .prepare(
          'UPDATE gate_participants SET status=?,outcome=?,reward_id=?,rank=?,remaining=?,finalized_at=?,updated_at=? WHERE id=? AND finalized_at IS NULL',
        )
        .bind(outcome, outcome, reward?.id ?? null, rank, remaining, now, now, participant.id),
      db
        .prepare("UPDATE claim_codes SET status=? WHERE participant_id=? AND status!='expired'")
        .bind(outcome, participant.id),
      db
        .prepare(
          "INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,'verified',?,?)",
        )
        .bind(crypto.randomUUID(), gate.id, participant.id, now, `verified:${participant.id}`),
      db
        .prepare(
          'INSERT INTO gate_events(id,gate_id,participant_id,type,at,dedup_key,meta) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          gate.id,
          participant.id,
          outcome,
          now,
          `final:${participant.id}`,
          JSON.stringify({ rank, remaining }),
        ),
      outboxStatement(
        db,
        gate.id,
        participant.id,
        'x.gate.verified',
        { ...base, tags: [`x-gate:${gate.slug}`] },
        now,
      ),
      outboxStatement(db, gate.id, participant.id, 'x.gate.reward_unlocked', payload, now),
    );
    try {
      await db.batch(statements);
      return true;
    } catch (error) {
      if (error instanceof Error && /reward_exhausted/.test(error.message)) continue;
      throw error;
    }
  }
  return false;
}
export async function participantResult(db: D1Database, participant: GateParticipant) {
  const claim = await db
    .prepare("SELECT * FROM claim_codes WHERE participant_id=? AND status!='expired'")
    .bind(participant.id)
    .first<ClaimCode>();
  const allocation = await db
    .prepare(
      'SELECT a.value,r.label,r.type FROM gate_allocations a JOIN gate_rewards r ON r.id=a.reward_id WHERE a.participant_id=?',
    )
    .bind(participant.id)
    .first<{ value: string; label: string; type: string }>();
  const notification = await db
    .prepare(
      "SELECT payload FROM event_outbox WHERE participant_id=? AND event='x.gate.reward_unlocked'",
    )
    .bind(participant.id)
    .first<{ payload: string }>();
  const detail = notification ? JSON.parse(notification.payload) : {};
  return {
    display: detail.display,
    followup: detail.followup,
    participantId: participant.id,
    status:
      participant.status === 'awaiting_reply' &&
      ['account_too_new', 'x_already_used'].includes(claim?.reject_reason ?? '')
        ? claim!.reject_reason
        : participant.status,
    rank: participant.rank,
    remaining: participant.remaining,
    xUsername: participant.x_username,
    replyCreatedAt: claim?.reply_created_at ?? null,
    missing: JSON.parse(participant.missing),
    retryAfterSec: Math.max(0, Math.ceil(((participant.retry_at ?? 0) - Date.now()) / 1000)),
    reward: allocation,
    rejectReason: claim?.reject_reason ?? null,
  };
}
