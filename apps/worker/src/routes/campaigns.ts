import { encryptSecret } from '@x-harness/db';
import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import { XClient } from '@x-harness/x-sdk';
import { createEngagementGate, getXAccountById, updateEngagementGate, incrementApiUsage } from '@x-harness/db';
import type { Env } from '../index.js';

const campaigns = new Hono<Env>();

// GET /api/campaigns/line-config — return LINE Harness connection status (no secrets)
campaigns.get('/api/campaigns/line-config', (c) => {
  const url = c.env.LINE_HARNESS_URL || '';
  const hasKey = !!c.env.LINE_HARNESS_API_KEY;
  return c.json({
    success: true,
    data: {
      configured: !!url && hasKey,
      url: url.replace(/\/$/, ''),
    },
  });
});

// POST /api/campaigns/line-proxy/tags — proxy tag creation to LINE Harness
campaigns.post('/api/campaigns/line-proxy/tags', async (c) => {
  const lineUrl = (c.env.LINE_HARNESS_URL || '').replace(/\/$/, '');
  const lineKey = c.env.LINE_HARNESS_API_KEY || '';
  if (!lineUrl || !lineKey) {
    return c.json({ success: false, error: 'LINE Harness not configured' }, 400);
  }
  const body = await c.req.json();
  const res = await fetch(`${lineUrl}/api/tags`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return c.json(data, res.status as 200);
});

// POST /api/campaigns/line-proxy/forms — proxy form creation to LINE Harness
campaigns.post('/api/campaigns/line-proxy/forms', async (c) => {
  const lineUrl = (c.env.LINE_HARNESS_URL || '').replace(/\/$/, '');
  const lineKey = c.env.LINE_HARNESS_API_KEY || '';
  if (!lineUrl || !lineKey) {
    return c.json({ success: false, error: 'LINE Harness not configured' }, 400);
  }
  const body = await c.req.json();
  const res = await fetch(`${lineUrl}/api/forms`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return c.json(data, res.status as 200);
});

interface CampaignInput {
  xAccountId: string;
  text: string;
  mediaIds?: string[];
  requireLike?: boolean;
  requireRepost?: boolean;
  requireFollow?: boolean;
  replyKeyword?: string | null;
  campaignLink?: string;
  lineHarnessUrl?: string;
  lineHarnessApiKey?: string;
  lineHarnessTag?: string;
}

campaigns.post('/api/campaigns', async (c) => {
  const body = await c.req.json<CampaignInput>();
  if(body.lineHarnessUrl || body.lineHarnessApiKey) {
    if(c.get('staffRole')!=='admin')return c.json({success:false,error:'Admin required for LINE connection'},403);
    if(body.lineHarnessUrl && new URL(body.lineHarnessUrl).protocol!=='https:')return c.json({success:false,error:'HTTPS required'},400);
    if(body.lineHarnessApiKey)body.lineHarnessApiKey=await encryptSecret(body.lineHarnessApiKey,c.env.ENCRYPTION_KEY);
  }

  if (!body.xAccountId || !body.text) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, text' }, 400);
  }

  // Resolve X account
  const account = await getXAccountById(c.env.DB, body.xAccountId);
  if (!account) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }

  // Build XClient
  const xClient = await buildXClient(c.env, account, 'campaigns');

  // Step 1: Create a placeholder gate first (need gateId for LINE form webhook URL)
  // Use a temporary postId — will be updated after tweet creation
  const tempPostId = `pending-${Date.now()}`;
  let gate: Awaited<ReturnType<typeof createEngagementGate>>;
  try {
    gate = await createEngagementGate(c.env.DB, {
      xAccountId: body.xAccountId,
      postId: tempPostId,
      triggerType: 'reply',
      actionType: 'verify_only',
      template: '',
      pollingStrategy: 'manual',
      requireLike: body.requireLike ?? false,
      requireRepost: body.requireRepost ?? false,
      requireFollow: body.requireFollow ?? false,
      replyKeyword: body.replyKeyword ?? undefined,
    });
    // Deactivate until tweet is posted
    await updateEngagementGate(c.env.DB, gate.id, { isActive: false });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to create engagement gate' }, 500);
  }

  const gateId = gate.id;

  // Step 2: Replace {link} placeholder with campaign link (provided by frontend)
  let finalText = body.text;
  if (body.campaignLink) {
    finalText = finalText.replace(/\{link\}/g, body.campaignLink);
  }

  let tweetId: string;
  try {
    const tweet = await xClient.createTweet({
      text: finalText,
      media: body.mediaIds && body.mediaIds.length > 0 ? { media_ids: body.mediaIds } : undefined,
    });
    tweetId = (tweet as any).id as string;
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'create_tweet'));
  } catch (err: any) {
    // Cleanup: delete the gate if tweet fails
    try { await c.env.DB.prepare('DELETE FROM engagement_gates WHERE id = ?').bind(gateId).run(); } catch {}
    return c.json({ success: false, error: err.message ?? 'Failed to create tweet' }, 500);
  }

  const tweetUrl = `https://x.com/${account.username}/status/${tweetId}`;

  // Step 4: Activate gate with real postId + LINE metadata if provided
  const gateUpdates: Record<string, unknown> = { postId: tweetId, isActive: true };
  if (body.lineHarnessUrl) gateUpdates.lineHarnessUrl = body.lineHarnessUrl;
  if (body.lineHarnessApiKey) gateUpdates.lineHarnessApiKey = body.lineHarnessApiKey;
  if (body.lineHarnessTag) gateUpdates.lineHarnessTag = body.lineHarnessTag;
  await updateEngagementGate(c.env.DB, gateId, gateUpdates);

  return c.json({
    success: true,
    data: { tweetId, tweetUrl, gateId },
  }, 201);
});

export { campaigns };
