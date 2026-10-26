import { createLineFirstCampaign } from '../services/create-line-campaign.js';
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

campaigns.post('/api/campaigns',async c=>createLineFirstCampaign(c,await c.req.json()));

export { campaigns };
