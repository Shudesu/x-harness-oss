import type { ClaimGate } from './claim-types.js';
import { getPublicCampaignStatus } from './campaign-status.js';
export async function buildCampaignSummary(
  db: D1Database,
  gateId: string,
  lineEngagement: number | null = null,
) {
  const gate = await db
    .prepare('SELECT * FROM engagement_gates WHERE id=?')
    .bind(gateId)
    .first<ClaimGate>();
  if (!gate) return null;
  const stages = (
    await db
      .prepare(
        'SELECT type,COUNT(DISTINCT COALESCE(participant_id,session_id,id)) AS count FROM gate_events WHERE gate_id=? GROUP BY type',
      )
      .bind(gateId)
      .all<{ type: string; count: number }>()
  ).results;
  const counts = Object.fromEntries(stages.map((r) => [r.type, r.count]));
  const apiCost =
    (
      await db
        .prepare(
          "SELECT COALESCE(SUM(cost_usd),0) AS total FROM api_spend_ledger WHERE source='x' AND feature=?",
        )
        .bind(`claim:${gateId}`)
        .first<{ total: number }>()
    )?.total ?? 0;
  const rewards = await db
    .prepare(
      'SELECT COALESCE(SUM(r.unit_cost),0) AS total,SUM(CASE WHEN r.unit_cost IS NULL THEN 1 ELSE 0 END) AS unknown FROM gate_allocations a JOIN gate_rewards r ON r.id=a.reward_id WHERE a.gate_id=?',
    )
    .bind(gateId)
    .first<{ total: number; unknown: number }>();
  const dead =
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM event_outbox WHERE gate_id=? AND status='dead'")
        .bind(gateId)
        .first<{ count: number }>()
    )?.count ?? 0;
  const pending =
    (
      await db
        .prepare(
          'SELECT COUNT(*) AS count FROM gate_participants WHERE gate_id=? AND finalized_at IS NULL',
        )
        .bind(gateId)
        .first<{ count: number }>()
    )?.count ?? 0;
  const impressions =
    (
      await db
        .prepare(
          "SELECT json_extract(meta,'$.value') AS value FROM gate_events WHERE gate_id=? AND type='impressions' AND dedup_key LIKE 'closed-metrics:%' ORDER BY at DESC LIMIT 1",
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
    await db
      .prepare(
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
  const status = await getPublicCampaignStatus(db, gate);
  const participantRow = await db
    .prepare('SELECT COUNT(*) AS n FROM gate_participants WHERE gate_id=?')
    .bind(gateId)
    .first<{ n: number }>();
  return {
    title: gate.title,
    slug: gate.slug,
    tier: gate.tier,
    awardMode: gate.award_mode,
    endsAt: gate.ends_at,
    state: status.state,
    remaining: status.remaining,
    unlimited: status.unlimited,
    participants: participantRow?.n ?? 0,
    impressions,
    campaign: status,
    counts,
    line: {
      resultMessages: null,
      finalized: (counts.won ?? 0) + (counts.lost ?? 0),
      followupOptIns: counts.followup_opt_in ?? 0,
      estimatedPushForEarlyNotice: counts.followup_opt_in ?? 0,
    },
    gate: {
      id: gate.id,
      x_account_id: gate.x_account_id,
      gate_mode: gate.gate_mode,
      gate_state: gate.gate_state,
      pause_reason: gate.pause_reason,
      tier: gate.tier,
      budget_usd: gate.budget_usd,
      campaign_post_cost_usd: gate.campaign_post_cost_usd,
      campaign_external_cost_usd: gate.campaign_external_cost_usd,
    },
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
  };
}
