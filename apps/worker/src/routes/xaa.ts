import { Hono } from 'hono';
import { getXAccounts, getXAccountById, insertXaaEvent, getXaaEvents } from '@x-harness/db';
import type { Env } from '../index.js';

const xaa = new Hono<Env>();

// Helper: compute HMAC-SHA256 using Web Crypto API
async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return `sha256=${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

// GET /webhook/xaa — CRC challenge response (called by X to verify the webhook URL)
// X sends ?crc_token=xxx. Respond with HMAC-SHA256 of the token using consumer_secret.
// This endpoint must NOT require auth — X calls it without any API key.
xaa.get('/webhook/xaa', async (c) => {
  const crcToken = c.req.query('crc_token');
  if (!crcToken) {
    return c.json({ success: false, error: 'Missing crc_token' }, 400);
  }

  // Use the first active account's consumer_secret
  const accounts = await getXAccounts(c.env.DB);
  const account = accounts[0] ?? null;
  if (!account || !account.consumer_secret) {
    return c.json({ success: false, error: 'No active X account with consumer_secret configured' }, 500);
  }

  const responseToken = await hmacSha256(account.consumer_secret, crcToken);
  return c.json({ response_token: responseToken });
});

// Constant-time string comparison — avoids leaking signature prefix length
// through timing differences.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// POST /webhook/xaa — receive real-time XAA events from X
// X posts event payloads here. Must respond with 200 within 10 seconds.
// This endpoint must NOT require auth — X calls it without any API key.
// Instead, X signs the payload: x-twitter-webhooks-signature =
// "sha256=" + base64(HMAC-SHA256(consumer_secret, raw_body)).
xaa.post('/webhook/xaa', async (c) => {
  const rawBody = await c.req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const eventType = (body.event_type as string | undefined)
    ?? ('direct_message_events' in body ? 'dm' : 'unknown');

  // Verify the signature against active accounts' consumer secrets.
  // This endpoint is public — persisting unsigned payloads would let anyone
  // pollute the events table / consume D1 storage.
  const signature = c.req.header('x-twitter-webhooks-signature');
  let verified = false;
  if (signature) {
    const accounts = await getXAccounts(c.env.DB);
    for (const acct of accounts) {
      if (!acct.consumer_secret) continue;
      const expected = await hmacSha256(acct.consumer_secret, rawBody);
      if (timingSafeEqual(expected, signature)) {
        verified = true;
        break;
      }
    }
  }

  console.log(`[XAA] Received event: ${eventType} (verified: ${verified})`);

  if (verified) {
    // Persist every event (post.create / post.delete / dm / ...) so real-time
    // activity is queryable via GET /api/xaa/events. Fire-and-forget — the
    // webhook must respond within 10s no matter what.
    c.executionCtx.waitUntil(
      insertXaaEvent(c.env.DB, eventType, body).catch((err) => console.error('[XAA] persist failed:', err)),
    );
  }

  // Always 200 — a non-2xx would make X disable the webhook, and an error
  // response would give probing clients a signature oracle.
  return c.json({ success: true }, 200);
});

// GET /api/xaa/events — list stored XAA events (newest first)
// Query: ?eventType=post.create&limit=50&offset=0
xaa.get('/api/xaa/events', async (c) => {
  const eventType = c.req.query('eventType');
  const limit = Number(c.req.query('limit') ?? '50') || 50;
  const offset = Number(c.req.query('offset') ?? '0') || 0;
  const events = await getXaaEvents(c.env.DB, { eventType, limit, offset });
  return c.json({
    success: true,
    data: events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      payload: JSON.parse(e.payload),
      receivedAt: e.received_at,
    })),
  });
});

// POST /api/xaa/webhook — register a webhook URL with X
// Body: { xAccountId?: string }
xaa.post('/api/xaa/webhook', async (c) => {
  const { xAccountId } = await c.req.json<{ xAccountId?: string }>();

  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }

  const workerUrl = c.env.WORKER_URL;
  if (!workerUrl) {
    return c.json({ success: false, error: 'WORKER_URL environment variable not set' }, 500);
  }

  const webhookUrl = `${workerUrl.replace(/\/$/, '')}/webhook/xaa`;

  try {
    const res = await fetch('https://api.x.com/2/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.access_token}`,
      },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error', details: data }, res.status as 400 | 401 | 403 | 500);
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to register webhook' }, 500);
  }
});

// POST /api/xaa/subscribe — create a subscription for XAA events
// Body: { xAccountId?: string, eventType: string, webhookId: string }
xaa.post('/api/xaa/subscribe', async (c) => {
  const { xAccountId, eventType, webhookId } = await c.req.json<{
    xAccountId?: string;
    eventType: string;
    webhookId: string;
  }>();

  if (!eventType || !webhookId) {
    return c.json({ success: false, error: 'Missing required fields: eventType, webhookId' }, 400);
  }

  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }

  try {
    const res = await fetch('https://api.x.com/2/activity/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.access_token}`,
      },
      body: JSON.stringify({ webhook_id: webhookId, event_types: [eventType] }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error', details: data }, res.status as 400 | 401 | 403 | 500);
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to create subscription' }, 500);
  }
});

// GET /api/xaa/subscriptions — list active XAA subscriptions
xaa.get('/api/xaa/subscriptions', async (c) => {
  const xAccountId = c.req.query('xAccountId');

  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }

  try {
    const res = await fetch('https://api.x.com/2/activity/subscriptions', {
      headers: {
        Authorization: `Bearer ${account.access_token}`,
      },
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error', details: data }, res.status as 400 | 401 | 403 | 500);
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to list subscriptions' }, 500);
  }
});

// DELETE /api/xaa/subscriptions/:id — delete a subscription
xaa.delete('/api/xaa/subscriptions/:id', async (c) => {
  const subscriptionId = c.req.param('id');
  const xAccountId = c.req.query('xAccountId');

  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }

  try {
    const res = await fetch(`https://api.x.com/2/activity/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
      },
    });

    if (res.status === 204) {
      return c.json({ success: true });
    }

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error', details: data }, res.status as 400 | 401 | 403 | 500);
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to delete subscription' }, 500);
  }
});

export { xaa };
