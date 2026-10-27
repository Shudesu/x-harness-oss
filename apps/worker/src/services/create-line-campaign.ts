import { conditionPolicies } from './campaign-policies.js';
import { validFollowup, earlyNoticeAudience } from './campaign-followup.js';
import { validateCampaignInput } from './campaign-validation.js';
import { buildXClient } from './x-client.js';
import { outboxStatement } from './line-events.js';
import type { Context } from 'hono';
import { createEngagementGate, getXAccountById, decryptSecret } from '@x-harness/db';
import type { Env } from '../index.js';
import type { GateLineConnection } from './claim-types.js';
import { requireRole } from '../middleware/auth.js';
import { signHarnessRequest, assertHttpsBase } from './harness-gate-protocol.js';
export async function createLineFirstCampaign(
  c: Context<Env>,
  body: Record<string, any>,
): Promise<Response> {
  const denied = requireRole(c, 'admin');
  if (denied) return denied;
  if (!body || body.mode !== 'line_first')
    return c.json(
      {
        success: false,
        error: 'Use the LINE-first campaign flow; legacy campaign creation is disabled',
      },
      400,
    );
  const validation = validateCampaignInput(body);
  if (!validation.ok)
    return c.json({ success: false, error: validation.errors[0].code, validation }, 400);
  if (body.entryPage !== undefined && !['redirect', 'status'].includes(body.entryPage))
    return c.json({ success: false, error: 'Invalid campaign display' }, 400);
  const tier = body.tier ?? 'standard',
    age = body.minAccountAgeDays ?? (tier === 'strict' ? 30 : 7),
    settle = body.settleSec ?? (tier === 'strict' ? 180 : 60),
    budget = body.budgetUsd ?? 10;
  if (!validFollowup(body.loserFollowup, body.rewards))
    return c.json(
      { success: false, error: 'Choose a separate consolation coupon or URL for follow-up' },
      400,
    );
  const rewardIds = body.rewards.map(() => crypto.randomUUID());
  const followup = body.loserFollowup ? { ...body.loserFollowup } : null;
  if (followup?.enabled && followup.offer !== 'early_notice') {
    const index =
      followup.couponRewardIndex ??
      body.rewards.findIndex((r: any) => r.id === followup.couponRewardId);
    followup.couponRewardId = rewardIds[index];
    delete followup.couponRewardIndex;
    if (
      tier === 'simple' &&
      !body.rewards.some(
        (r: any, i: number) => i !== index && r.quota === null && r.type !== 'coupon_code',
      )
    )
      return c.json(
        { success: false, error: 'Simple tier needs a separate unlimited participation reward' },
        400,
      );
  }
  const connection = await c.env.DB.prepare('SELECT * FROM line_connections WHERE id=?')
    .bind(body.lineConnectionId ?? '')
    .first<GateLineConnection>();
  const account = await getXAccountById(c.env.DB, body.xAccountId ?? '');
  if (
    !connection?.integration_secret ||
    !account?.is_active ||
    !/^[A-Za-z0-9_]{1,15}$/.test(account.username)
  )
    return c.json(
      { success: false, error: 'Configure an active X account and signed LINE connection first' },
      400,
    );
  if (body.earlyNoticeFromGateIds?.length && body.confirmEarlyNotice !== true)
    return c.json({ success: false, error: 'Confirm the early-notice audience first' }, 400);
  try {
    await earlyNoticeAudience(
      c.env.DB,
      body.earlyNoticeFromGateIds ?? [],
      account.id,
      connection.id,
    );
  } catch {
    return c.json({ success: false, error: 'Invalid early-notice sources' }, 400);
  }
  const existing = await c.env.DB.prepare('SELECT id,gate_state FROM engagement_gates WHERE slug=?')
    .bind(body.slug)
    .first<{ id: string; gate_state: string }>();
  if (existing)
    return c.json(
      {
        success: false,
        error: 'Slug already exists; inspect the existing draft before retrying',
        gateId: existing.id,
        state: existing.gate_state,
      },
      409,
    );
  const gate = await createEngagementGate(c.env.DB, {
    xAccountId: account.id,
    postId: body.postId,
    triggerType: 'reply',
    actionType: 'verify_only',
    template: '',
    pollingStrategy: 'manual',
  });
  const now = new Date().toISOString();
  let partnerAttempted = false;
  try {
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "UPDATE engagement_gates SET gate_mode='line_first',slug=?,title=?,ends_at=?,tier=?,line_connection_id=?,reply_hashtag=?,claim_phrase=?,award_mode=?,settle_sec=?,min_account_age_days=?,min_followers=?,brand_username=?,budget_usd=?,gate_state='draft',is_active=0,require_follow=?,updated_at=? WHERE id=?",
      ).bind(
        body.slug,
        body.title,
        new Date(body.endsAt).toISOString(),
        tier,
        connection.id,
        body.replyHashtag?.replace(/^#/, '') ?? null,
        body.claimPhrase.normalize('NFKC'),
        body.awardMode ?? 'first_come',
        settle,
        age,
        tier === 'strict' ? Math.max(5, Math.floor(body.minFollowers ?? 5)) : 0,
        account.username,
        budget,
        tier === 'strict' || body.requireFollow ? 1 : 0,
        now,
        gate.id,
      ),
    ];
    for (let index = 0; index < body.rewards.length; index++) {
      const reward = body.rewards[index],
        id = rewardIds[index];
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota,weight,is_consolation,unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          id,
          gate.id,
          index,
          reward.label,
          reward.type,
          reward.value,
          reward.quota,
          reward.weight ?? 1,
          reward.consolation ? 1 : 0,
          reward.unitCost ?? null,
        ),
      );
      for (const code of new Set<string>(reward.codes ?? []))
        statements.push(
          c.env.DB.prepare('INSERT INTO reward_codes(id,reward_id,code) VALUES (?,?,?)').bind(
            crypto.randomUUID(),
            id,
            code,
          ),
        );
    }
    statements.push(
      c.env.DB.prepare(
        'UPDATE engagement_gates SET campaign_post_cost_usd=?,campaign_external_cost_usd=? WHERE id=?',
      ).bind(body.postCostUsd ?? null, body.externalCostUsd ?? null, gate.id),
    );
    statements.push(
      c.env.DB.prepare(
        'UPDATE engagement_gates SET entry_page=?,message_templates=?,loser_followup=? WHERE id=?',
      ).bind(
        body.entryPage ?? 'redirect',
        body.messageTemplates ? JSON.stringify(body.messageTemplates) : null,
        followup ? JSON.stringify(followup) : null,
        gate.id,
      ),
    );
    const policies = conditionPolicies(body);
    statements.push(
      c.env.DB.prepare('UPDATE engagement_gates SET follow_policy=?,like_policy=? WHERE id=?').bind(
        policies.follow,
        policies.like,
        gate.id,
      ),
    );
    await c.env.DB.batch(statements);
    if (tier !== 'simple') {
      const client = await buildXClient(c.env, account, `claim:${gate.id}`);
      const post = await client.getTweet(body.postId);
      if (post.author_id !== account.x_user_id) throw new Error('announcement_account_mismatch');
    }
    const path = '/api/integrations/x-harness/campaigns',
      payload = JSON.stringify({
        gateId: gate.id,
        name: body.title,
        slug: body.slug,
        tier,
        lineAccountId: connection.line_account_id,
        scenarios: body.scenarios ?? {},
      });
    const headers = await signHarnessRequest(
      await decryptSecret(connection.integration_secret, c.env.ENCRYPTION_KEY),
      'POST',
      path,
      payload,
      { connectionId: connection.id, event: 'x.gate.configure', deliveryId: gate.id },
    );
    headers.Authorization = `Bearer ${await decryptSecret(connection.api_key, c.env.ENCRYPTION_KEY)}`;
    headers['Idempotency-Key'] = gate.id;
    partnerAttempted = true;
    const response = await fetch(assertHttpsBase(connection.worker_url) + path, {
      method: 'POST',
      headers,
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`line_configuration_http_${response.status}`);
    const result = (await response.json()) as { data?: { trackedLinkRef?: string } };
    if (!result.data?.trackedLinkRef || !/^[A-Za-z0-9_-]{1,128}$/.test(result.data.trackedLinkRef))
      throw new Error('invalid_line_response');
    await c.env.DB.prepare(
      "UPDATE engagement_gates SET tracked_link_ref=?,gate_state='active',is_active=1 WHERE id=?",
    )
      .bind(result.data.trackedLinkRef, gate.id)
      .run();
    if (body.earlyNoticeFromGateIds?.length)
      await outboxStatement(
        c.env.DB,
        gate.id,
        `early-notice:${gate.id}`,
        'x.campaign.early_notice',
        {
          schema: 'xh.gate.v1',
          gateId: gate.id,
          sourceGateIds: body.earlyNoticeFromGateIds,
          title: body.title,
          entryUrl: `${c.env.WORKER_URL}/c/${body.slug}`,
        },
      ).run();
    return c.json(
      {
        success: true,
        data: {
          id: gate.id,
          slug: body.slug,
          state: 'active',
          entryUrl: `${c.env.WORKER_URL}/c/${body.slug}`,
        },
      },
      201,
    );
  } catch (error) {
    if (partnerAttempted)
      await outboxStatement(c.env.DB, gate.id, `configuration:${gate.id}`, 'x.gate.cancel', {
        gateId: gate.id,
      }).run();
    await c.env.DB.prepare(
      "UPDATE engagement_gates SET gate_state='failed',is_active=0,pause_reason=? WHERE id=?",
    )
      .bind(error instanceof Error ? error.message : 'configuration_failed', gate.id)
      .run();
    return c.json(
      {
        success: false,
        error:
          'Campaign was not activated. Inspect the failed draft and create a new campaign; no X post was sent.',
        gateId: gate.id,
      },
      502,
    );
  }
}
