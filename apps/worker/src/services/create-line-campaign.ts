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
  if (body.requireFollow !== undefined && typeof body.requireFollow !== 'boolean')
    return c.json({ success: false, error: 'Invalid follow condition' }, 400);
  if (
    body.scenarios !== undefined &&
    (!body.scenarios ||
      typeof body.scenarios !== 'object' ||
      Array.isArray(body.scenarios) ||
      Object.entries(body.scenarios).some(
        ([key, value]) => !['claimed', 'won', 'lost'].includes(key) || typeof value !== 'string',
      ))
  )
    return c.json({ success: false, error: 'Invalid scenarios' }, 400);
  const tier = body.tier ?? 'standard',
    age = body.minAccountAgeDays ?? (tier === 'strict' ? 30 : 7),
    settle = body.settleSec ?? (tier === 'strict' ? 180 : 60),
    budget = body.budgetUsd ?? 10;
  if (
    typeof body.slug !== 'string' ||
    !/^[a-z0-9-]{2,64}$/.test(body.slug) ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.length > 100 ||
    typeof body.claimPhrase !== 'string' ||
    !/^[\p{L}\p{N}]{2,8}$/u.test(body.claimPhrase) ||
    !['simple', 'standard', 'strict'].includes(tier) ||
    !['first_come', 'lottery'].includes(body.awardMode ?? 'first_come') ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > 3650 ||
    (tier === 'strict' && age < 30) ||
    !Number.isInteger(settle) ||
    settle < 0 ||
    settle > 300 ||
    !Number.isFinite(budget) ||
    budget < 0 ||
    budget > 100000 ||
    typeof body.postId !== 'string' ||
    !/^\d{1,25}$/.test(body.postId) ||
    typeof body.endsAt !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(body.endsAt) ||
    !Number.isFinite(Date.parse(body.endsAt)) ||
    Date.parse(body.endsAt) <= Date.now()
  )
    return c.json({ success: false, error: 'Invalid campaign configuration' }, 400);
  if (!Array.isArray(body.rewards) || body.rewards.length < 1 || body.rewards.length > 10)
    return c.json({ success: false, error: '1–10 reward tiers required' }, 400);
  for (const reward of body.rewards) {
    if (
      !reward ||
      typeof reward.label !== 'string' ||
      reward.label.length > 100 ||
      !reward.label ||
      (reward.consolation !== undefined && typeof reward.consolation !== 'boolean') ||
      !['coupon_code', 'url', 'line_message', 'file'].includes(reward.type) ||
      typeof reward.value !== 'string' ||
      reward.value.length > 2000 ||
      (reward.quota !== null && (!Number.isSafeInteger(reward.quota) || reward.quota < 0)) ||
      !Number.isFinite(reward.weight ?? 1) ||
      (reward.weight ?? 1) < 0 ||
      (reward.weight ?? 1) > 1000000 ||
      (reward.unitCost !== undefined && (!Number.isFinite(reward.unitCost) || reward.unitCost < 0))
    )
      return c.json({ success: false, error: 'Invalid reward' }, 400);
    if (['url', 'file'].includes(reward.type)) {
      try {
        if (new URL(reward.value).protocol !== 'https:') throw new Error();
      } catch {
        return c.json({ success: false, error: 'Reward URLs must be HTTPS' }, 400);
      }
    }
    if (
      reward.type === 'coupon_code' &&
      (!Array.isArray(reward.codes) ||
        !reward.codes.length ||
        reward.codes.length > 1000 ||
        reward.codes.some((x: unknown) => typeof x !== 'string' || !x || x.length > 200))
    )
      return c.json({ success: false, error: 'Coupon code list required (max 1000)' }, 400);
  }
  if (
    tier === 'simple' &&
    !body.rewards.some((r: any) => r.quota === null && r.type !== 'coupon_code')
  )
    return c.json(
      { success: false, error: 'Simple tier requires an unlimited non-code participation reward' },
      400,
    );
  if (
    body.awardMode === 'lottery' &&
    body.rewards.reduce((sum: number, r: any) => sum + (r.weight ?? 1), 0) <= 0
  )
    return c.json({ success: false, error: 'Lottery weights must have a positive total' }, 400);
  if (
    body.minFollowers !== undefined &&
    (!Number.isInteger(body.minFollowers) || body.minFollowers < 0 || body.minFollowers > 100000000)
  )
    return c.json({ success: false, error: 'Invalid follower count' }, 400);
  if (
    body.replyHashtag !== undefined &&
    body.replyHashtag !== '' &&
    (typeof body.replyHashtag !== 'string' ||
      !/^[\p{L}\p{N}_]{1,40}$/u.test(body.replyHashtag.replace(/^#/, '')))
  )
    return c.json({ success: false, error: 'Invalid hashtag' }, 400);
  for (const value of [body.postCostUsd, body.externalCostUsd])
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      return c.json({ success: false, error: 'Invalid campaign cost' }, 400);
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
        id = crypto.randomUUID();
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
      redirect: 'error',
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
