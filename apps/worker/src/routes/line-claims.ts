import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { decryptSecret } from '@x-harness/db';
import type { Env } from '../index.js';
import type {
  ClaimGate,
  GateLineConnection,
  GateParticipant,
  ClaimCode,
} from '../services/claim-types.js';
import { verifyHarnessRequest, bodyDigest } from '../services/harness-gate-protocol.js';
import { issueClaim, getParticipant, goUrl, recordGateEvent } from '../services/claim-codes.js';
import { participantResult } from '../services/gate-rewards.js';
import { pollClaimGate } from '../services/claim-poller.js';
const lineClaims = new Hono<Env>();
lineClaims.use(
  '/api/integrations/line-harness/*',
  bodyLimit({
    maxSize: 131072,
    onError: (c) => c.json({ success: false, error: 'Request too large' }, 413),
  }),
);
export async function wakeClaimGate(env: Env['Bindings'], gateId: string) {
  if (env.GATE_CLAIMS) {
    const stub = env.GATE_CLAIMS.get(env.GATE_CLAIMS.idFromName(gateId));
    return stub.fetch('https://internal/check', {
      method: 'POST',
      body: JSON.stringify({ gateId }),
    });
  }
  return Response.json(await pollClaimGate(env, gateId));
}
lineClaims.post('/api/integrations/line-harness/claims', async (c) => handle(c));
lineClaims.post('/api/integrations/line-harness/events', async (c) => handle(c));
lineClaims.post('/api/integrations/line-harness/claims/check', async (c) => handle(c, true));
async function handle(c: import('hono').Context<Env>, check = false): Promise<Response> {
  const connectionId = c.req.header('X-Harness-Connection-Id') ?? '';
  const connection = await c.env.DB.prepare('SELECT * FROM line_connections WHERE id=?')
    .bind(connectionId)
    .first<GateLineConnection>();
  if (!connection?.integration_secret)
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  if (Number(c.req.header('Content-Length')) > 131072)
    return c.json({ success: false, error: 'Request too large' }, 413);
  const raw = await c.req.text();
  const signature = await verifyHarnessRequest(
    await decryptSecret(connection.integration_secret, c.env.ENCRYPTION_KEY),
    c.req.raw,
    raw,
    connectionId,
  );
  if (!signature) return c.json({ success: false, error: 'Unauthorized' }, 401);
  let body: {
    gateId?: string;
    lineFriendId?: string;
    participantId?: string;
    type?: string;
    sourceId?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body.gateId !== 'string')
    return c.json({ success: false, error: 'Invalid gate' }, 400);
  const gate = await c.env.DB.prepare(
    "SELECT * FROM engagement_gates WHERE id=? AND line_connection_id=? AND gate_mode='line_first'",
  )
    .bind(body.gateId, connectionId)
    .first<ClaimGate>();
  if (!gate) return c.json({ success: false, error: 'Not found' }, 404);
  if (c.req.path.endsWith('/events')) {
    if (
      signature.event !== 'line.gate.event' ||
      !['line_added', 'line_engaged', 'reward_redeemed'].includes(body.type ?? '') ||
      typeof body.lineFriendId !== 'string' ||
      typeof body.sourceId !== 'string' ||
      body.sourceId.length > 128
    )
      return c.json({ success: false, error: 'Invalid event' }, 400);
    const participant = await getParticipant(c.env.DB, gate.id, body.lineFriendId);
    if (!participant) return c.json({ success: false, error: 'Participant not found' }, 404);
    const hash = await bodyDigest(raw),
      receipt = await c.env.DB.prepare(
        'SELECT body_hash FROM gate_partner_receipts WHERE delivery_id=?',
      )
        .bind(signature.deliveryId)
        .first<{ body_hash: string }>();
    if (receipt && receipt.body_hash !== hash)
      return c.json({ success: false, error: 'Delivery conflict' }, 409);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO gate_partner_receipts(delivery_id,connection_id,body_hash,event,status,created_at) VALUES (?,?,?,?,'done',?)",
      ).bind(signature.deliveryId, connectionId, hash, signature.event, Date.now()),
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,?,?,?)',
      ).bind(
        crypto.randomUUID(),
        gate.id,
        participant.id,
        body.type,
        Date.now(),
        `lh:${gate.id}:${body.type}:${body.sourceId}`,
      ),
    ]);
    return c.json({ success: true });
  }
  if (
    signature.event !== (check ? 'line.gate.check' : 'line.gate.claim') ||
    typeof body.lineFriendId !== 'string' ||
    !body.lineFriendId ||
    body.lineFriendId.length > 128
  )
    return c.json({ success: false, error: 'Invalid claim' }, 400);
  let participant: GateParticipant | null = await getParticipant(
      c.env.DB,
      gate.id,
      body.lineFriendId,
    ),
    claim: ClaimCode | null = null;
  if (
    !check &&
    (!participant ||
      (gate.is_active && gate.gate_state === 'active' && Date.parse(gate.ends_at) > Date.now()))
  ) {
    try {
      const issued = await issueClaim(c.env.DB, gate, body.lineFriendId);
      participant = issued.participant;
      claim = issued.claim;
    } catch (error) {
      if (error instanceof Error && error.message === 'gate_ended')
        return c.json({ success: true, data: { status: 'ended', tier: gate.tier } });
      throw error;
    }
  }
  if (!participant) return c.json({ success: false, error: 'Claim not found' }, 404);
  let retryAfterSec = 0;
  if (!participant.finalized_at && gate.is_active && gate.gate_state === 'active') {
    if (check || gate.tier === 'simple') {
      const response = await wakeClaimGate(c.env, gate.id);
      const state = (await response.json()) as { retryAfterSec?: number };
      retryAfterSec = state.retryAfterSec ?? 10;
    } else c.executionCtx.waitUntil(wakeClaimGate(c.env, gate.id).then(() => {}));
    participant = (await getParticipant(c.env.DB, gate.id, body.lineFriendId))!;
  }
  if (!claim && !participant.finalized_at)
    claim = await c.env.DB.prepare(
      'SELECT * FROM claim_codes WHERE participant_id=? ORDER BY issued_at DESC LIMIT 1',
    )
      .bind(participant.id)
      .first<ClaimCode>();
  const result = await participantResult(c.env.DB, participant);
  c.header('Cache-Control', 'no-store');
  return c.json({
    success: true,
    data: {
      ...result,
      tier: gate.tier,
      awardMode: gate.award_mode,
      title: gate.title,
      brandUsername: gate.brand_username,
      minAccountAgeDays: gate.min_account_age_days,
      minFollowers: gate.min_followers,
      retryAfterSec: Math.max(result.retryAfterSec, retryAfterSec),
      ...(claim
        ? {
            code: claim.code,
            displayCode: `${gate.claim_phrase}-${claim.code}`,
            postUrl: `https://x.com/${gate.brand_username}/status/${gate.post_id}`,
            replyText: `${gate.claim_phrase}-${claim.code} 参加します！${gate.reply_hashtag ? ' #' + gate.reply_hashtag : ''} @${gate.brand_username} https://x.com/${gate.brand_username}/status/${gate.post_id}`,
            goUrl: goUrl(c.env.WORKER_URL, gate, claim.code),
            expiresAt: new Date(claim.expires_at).toISOString(),
          }
        : {}),
      status:
        !gate.is_active && !participant.finalized_at
          ? gate.gate_state === 'ended'
            ? 'ended'
            : 'paused'
          : gate.tier === 'simple' && participant.finalized_at
            ? 'rewarded'
            : result.status,
    },
  });
}
export { lineClaims };
