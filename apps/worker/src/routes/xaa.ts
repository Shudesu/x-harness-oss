import { decryptSecret, recordSpend } from '@x-harness/db';
import { buildXClient } from '../services/x-client.js';
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
  const accountId=c.req.query('accountId');
  const account = (accountId ? accounts.find(a=>a.id===accountId) : accounts.length===1?accounts[0]:null) ?? null;
  if (!account || !account.consumer_secret) {
    return c.json({ success: false, error: 'No active X account with consumer_secret configured' }, 500);
  }

  const responseToken = await hmacSha256(await decryptSecret(account.consumer_secret,c.env.ENCRYPTION_KEY), crcToken);
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
  if(Number(c.req.header('Content-Length'))>1048576)return c.json({success:false},413);
  const rawBody = await c.req.text();
  if(rawBody.length>1048576)return c.json({success:false},413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const envelope = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data as Record<string,unknown> : body;
  const eventType = (envelope.event_type as string | undefined)
    ?? ('direct_message_events' in body ? 'dm' : 'unknown');

  // Verify the signature against active accounts' consumer secrets.
  // This endpoint is public — persisting unsigned payloads would let anyone
  // pollute the events table / consume D1 storage.
  const signature = c.req.header('x-twitter-webhooks-signature');
  let verified = false;
  let verifiedAccountId: string|undefined;
  if (signature) {
    const accounts = await getXAccounts(c.env.DB);
    for (const acct of accounts) {
      if (!acct.consumer_secret) continue;
      const expected = await hmacSha256(await decryptSecret(acct.consumer_secret,c.env.ENCRYPTION_KEY), rawBody);
      if (timingSafeEqual(expected, signature)) {
        if(body.for_user_id && body.for_user_id !== acct.x_user_id) continue;
        const selected=c.req.query('accountId');if(selected && selected!==acct.id)continue;
        verified = true;
        verifiedAccountId=acct.id;
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
      persistVerifiedEvent(c.env.DB,verifiedAccountId!,eventType,body).catch(()=>console.error('[XAA] persist failed')),
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

  const webhookUrl = `${workerUrl.replace(/\/$/, '')}/webhook/xaa?accountId=${encodeURIComponent(account.id)}`;

  try {
    const xClient=await buildXClient(c.env,account,'xaa-management');
    const res = await xClient.fetchRaw('https://api.x.com/2/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await decryptSecret(account.access_token,c.env.ENCRYPTION_KEY)}`,
      },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error' }, res.status as 400 | 401 | 403 | 500);
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
    const xClient=await buildXClient(c.env,account,'xaa-management');
    const res = await xClient.fetchRaw('https://api.x.com/2/activity/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await decryptSecret(account.access_token,c.env.ENCRYPTION_KEY)}`,
      },
      body: JSON.stringify({ webhook_id: webhookId, event_types: [eventType] }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error' }, res.status as 400 | 401 | 403 | 500);
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
    const xClient=await buildXClient(c.env,account,'xaa-management');
    const res = await xClient.fetchRaw('https://api.x.com/2/activity/subscriptions', {
      headers: {
        Authorization: `Bearer ${await decryptSecret(account.access_token,c.env.ENCRYPTION_KEY)}`,
      },
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error' }, res.status as 400 | 401 | 403 | 500);
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
    const xClient=await buildXClient(c.env,account,'xaa-management');
    const res = await xClient.fetchRaw(`https://api.x.com/2/activity/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${await decryptSecret(account.access_token,c.env.ENCRYPTION_KEY)}`,
      },
    });

    if (res.status === 204) {
      return c.json({ success: true });
    }

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return c.json({ success: false, error: 'X API error' }, res.status as 400 | 401 | 403 | 500);
    }

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to delete subscription' }, 500);
  }
});

export { xaa };

async function persistVerifiedEvent(db:D1Database,accountId:string,eventType:string,body:Record<string,unknown>){
  await insertXaaEvent(db,eventType,body);
  const envelope=body.data && typeof body.data==='object' && !Array.isArray(body.data)?body.data as Record<string,any>:body as Record<string,any>;
  const tweets=Array.isArray(body.tweet_create_events)?[...body.tweet_create_events]:[];
  if(eventType==='post.create' && envelope.payload?.id) {
    const post=envelope.payload;
    const user=envelope.includes?.users?.find((u:any)=>u.id===post.author_id);
    tweets.push({id_str:post.id,in_reply_to_status_id_str:post.in_reply_to_tweet_id ?? post.referenced_tweets?.find((t:any)=>t.type==='replied_to')?.id,text:post.text,user:{id_str:post.author_id,screen_name:user?.username ?? '',name:user?.name ?? ''}});
  }
  const eventPrices:Record<string,number>={'follow.follow':.01,'follow.unfollow':.01,'mute.mute':.001,'mute.unmute':.001,'block.block':.001,'block.unblock':.001,'dm.received':.01,'chat.received':.01,'news.new':.005,'spaces.start':.005,'spaces.end':.005};
  const price=eventType.startsWith('profile.update.') ? 0.005 : eventPrices[eventType];
  if(price && envelope.event_uuid){const first=await db.prepare('INSERT OR IGNORE INTO ai_locks(id,expires_at) VALUES (?,?) RETURNING id').bind(`xaa:${accountId}:${new Date().toISOString().slice(0,10)}:${envelope.event_uuid}`,Date.now()+86400000).first();if(first)await recordSpend(db,{accountId,feature:'xaa',endpoint:'/webhook/xaa',resourceType:eventType,units:1,unitCost:price});}

  for(const raw of tweets){
    const tweet=raw as {id_str?:string;in_reply_to_status_id_str?:string;text?:string;user?:{id_str?:string;screen_name?:string;name?:string}};
    if(!tweet.id_str || !tweet.user?.id_str)continue;
    const gates=(await db.prepare("SELECT id FROM engagement_gates WHERE x_account_id=? AND post_id=? AND is_active=1 AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))").bind(accountId,tweet.in_reply_to_status_id_str ?? '').all<{id:string}>()).results;
    for(const gate of gates) await db.prepare('INSERT OR IGNORE INTO reply_trigger_queue(gate_id,tweet_id,json,created_at) VALUES (?,?,?,?)').bind(gate.id,tweet.id_str,JSON.stringify({id:tweet.user.id_str,username:tweet.user.screen_name ?? '',name:tweet.user.name ?? '',text:tweet.text ?? ''}),Date.now()).run();
    const key=`xaa-post:${accountId}:${new Date().toISOString().slice(0,10)}:${tweet.id_str}`;
    const first=await db.prepare('INSERT OR IGNORE INTO ai_locks(id,expires_at) VALUES (?,?) RETURNING id').bind(key,Date.now()+86400000).first();
    if(first)await recordSpend(db,{accountId,feature:'xaa',endpoint:'/webhook/xaa',resourceType:'webhook_post',units:1,unitCost:.005});
  }
}
