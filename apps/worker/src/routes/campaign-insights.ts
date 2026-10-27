import { draftCampaign } from '../services/campaign-draft.js';
import { earlyNoticeAudience } from '../services/campaign-followup.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/auth.js';
import { buildCampaignSummary } from '../services/campaign-summary.js';
import { estimateCampaign } from '../services/campaign-estimate.js';
import { digestChannels, readDigestSettings } from '../services/digest-settings.js';
import { sendDigests } from '../services/campaign-digest.js';
const campaignInsights = new Hono<Env>();
campaignInsights.get('/api/campaigns/estimate', async (c) => {
  const denied = requireRole(c, 'admin', 'editor');
  if (denied) return denied;
  try {
    return c.json({ success: true, data: await estimateCampaign(c.env.DB, c.req.query()) });
  } catch {
    return c.json({ success: false, error: 'Invalid estimate input' }, 400);
  }
});
campaignInsights.get('/api/campaigns/:id/status', async (c) => {
  const denied = requireRole(c, 'admin', 'editor');
  if (denied) return denied;
  const summary = await buildCampaignSummary(c.env.DB, c.req.param('id'));
  return summary
    ? c.json({ success: true, data: summary.campaign })
    : c.json({ success: false, error: 'Not found' }, 404);
});
campaignInsights.get('/api/campaigns/:id/digest', async (c) => {
  const denied = requireRole(c, 'admin', 'editor');
  if (denied) return denied;
  const rows = (
    await c.env.DB.prepare(
      'SELECT id,kind,period_key,channel,lines,generated,status,attempts,last_error,created_at,sent_at FROM campaign_digests WHERE gate_id=? ORDER BY created_at DESC LIMIT 10',
    )
      .bind(c.req.param('id'))
      .all()
  ).results;
  return c.json({ success: true, data: rows });
});
campaignInsights.post('/api/campaigns/:id/digest/test', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return denied;
  const body = await c.req.json<{ channel?: string; confirm?: boolean }>(),
    gateId = c.req.param('id');
  if (!body || body.confirm !== true || !['line', 'slack', 'email'].includes(body.channel ?? ''))
    return c.json({ success: false, error: 'Confirm the configured destination first' }, 400);
  const channel = body.channel as 'line' | 'slack' | 'email';
  if (!digestChannels((await readDigestSettings(c.env.DB)).digest_channels).includes(channel))
    return c.json({ success: false, error: 'Channel disabled' }, 400);
  const gate = await c.env.DB.prepare(
    "SELECT line_connection_id FROM engagement_gates WHERE id=? AND gate_mode='line_first'",
  )
    .bind(gateId)
    .first<{ line_connection_id: string }>();
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  const now = Date.now();
  if (
    !(await c.env.DB.prepare(
      'INSERT INTO campaign_digest_tests(gate_id,channel,last_at) VALUES (?,?,?) ON CONFLICT(gate_id,channel) DO UPDATE SET last_at=excluded.last_at WHERE last_at<=? RETURNING gate_id',
    )
      .bind(gateId, channel, now, now - 600000)
      .first())
  )
    return c.json({ success: false, error: 'One test per channel every 10 minutes' }, 429);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO campaign_digests(id,gate_id,kind,period_key,channel,lines,next_at,created_at,connection_id) VALUES (?,?,'weekly',?,?,?,?,?,?)",
  )
    .bind(
      id,
      gateId,
      `test:${id}`,
      channel,
      JSON.stringify([
        '結果通知のテストです。',
        '参加者への通知ではありません。',
        '通知先を確認できました。',
      ]),
      now,
      now,
      channel === 'line' ? gate.line_connection_id : null,
    )
    .run();
  await sendDigests(c.env, now, id);
  const result = await c.env.DB.prepare('SELECT status,last_error FROM campaign_digests WHERE id=?')
    .bind(id)
    .first();
  return c.json({ success: true, data: result });
});
campaignInsights.post('/api/campaigns/early-notice/estimate', async (c) => {
  const denied = requireRole(c, 'admin', 'editor');
  if (denied) return denied;
  const b = await c.req.json();
  try {
    return c.json({
      success: true,
      data: {
        estimatedPush: await earlyNoticeAudience(
          c.env.DB,
          b.sourceGateIds,
          b.xAccountId,
          b.lineConnectionId,
        ),
      },
    });
  } catch {
    return c.json({ success: false, error: 'Invalid source gates' }, 400);
  }
});
campaignInsights.post('/api/campaigns/draft', async (c) => {
  const denied = requireRole(c, 'admin', 'editor');
  if (denied) return denied;
  try {
    return c.json({ success: true, data: await draftCampaign(c.env, await c.req.json()) });
  } catch {
    return c.json({ success: false, error: 'Invalid draft input or account' }, 400);
  }
});
export { campaignInsights };
