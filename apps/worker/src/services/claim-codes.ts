import type { ClaimGate, ClaimCode, GateParticipant } from './claim-types.js';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(): string {
  let result = '';
  while (result.length < 5) {
    const b = crypto.getRandomValues(new Uint8Array(8));
    for (const n of b)
      if (n < Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length && result.length < 5)
        result += CODE_ALPHABET[n % CODE_ALPHABET.length];
  }
  return result;
}
export function extractCodes(text: string, phrase: string): string[] {
  const value = text.normalize('NFKC').toUpperCase(),
    escaped = phrase
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...value.matchAll(new RegExp(escaped + '[-ー\\s]?([A-HJKMNP-Z2-9]{5})(?![A-Z0-9])', 'g')),
  ].map((m) => m[1]);
}
export async function recordGateEvent(
  db: D1Database,
  gateId: string,
  type: string,
  participantId: string | null = null,
  meta: unknown = {},
  dedupKey?: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,meta,dedup_key) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      gateId,
      participantId,
      type,
      Date.now(),
      JSON.stringify(meta),
      dedupKey ?? null,
    )
    .run();
}
export async function getParticipant(db: D1Database, gateId: string, friendId: string) {
  return db
    .prepare('SELECT * FROM gate_participants WHERE gate_id=? AND line_friend_id=?')
    .bind(gateId, friendId)
    .first<GateParticipant>();
}
export async function issueClaim(
  db: D1Database,
  gate: ClaimGate,
  friendId: string,
  now = Date.now(),
): Promise<{ participant: GateParticipant; claim: ClaimCode | null }> {
  const prior = await getParticipant(db, gate.id, friendId);
  if (prior?.finalized_at) return { participant: prior, claim: null };
  if (
    gate.gate_mode !== 'line_first' ||
    gate.gate_state !== 'active' ||
    !gate.is_active ||
    Date.parse(gate.ends_at) <= now
  )
    throw new Error('gate_ended');
  await db
    .prepare(
      'INSERT OR IGNORE INTO gate_participants(id,gate_id,line_friend_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      gate.id,
      friendId,
      gate.tier === 'simple' ? 'verified' : 'awaiting_reply',
      now,
      now,
    )
    .run();
  const participant = (await getParticipant(db, gate.id, friendId))!;
  if (gate.tier === 'simple' || participant.finalized_at) return { participant, claim: null };
  const existing = await db
    .prepare("SELECT * FROM claim_codes WHERE participant_id=? AND status!='expired'")
    .bind(participant.id)
    .first<ClaimCode>();
  if (existing && (existing.expires_at > now || existing.status !== 'awaiting_reply'))
    return { participant, claim: existing };
  const expires = Math.min(Date.parse(gate.ends_at), now + 72 * 3600000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(),
      id = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(
            "UPDATE claim_codes SET status='expired' WHERE participant_id=? AND status='awaiting_reply' AND expires_at<=?",
          )
          .bind(participant.id, now),
        db
          .prepare(
            'INSERT INTO claim_codes(id,participant_id,gate_id,code,issued_at,expires_at) VALUES (?,?,?,?,?,?)',
          )
          .bind(id, participant.id, gate.id, code, now, expires),
        db.prepare('UPDATE engagement_gates SET last_claim_at=? WHERE id=?').bind(now, gate.id),
        db
          .prepare(
            "UPDATE gate_participants SET status='awaiting_reply',missing='[]',retry_at=NULL,updated_at=? WHERE id=? AND finalized_at IS NULL",
          )
          .bind(now, participant.id),
        db
          .prepare(
            "INSERT INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,'code_issued',?,?)",
          )
          .bind(crypto.randomUUID(), gate.id, participant.id, now, `code:${id}`),
      ]);
      return {
        participant: (await getParticipant(db, gate.id, friendId))!,
        claim: (await db
          .prepare('SELECT * FROM claim_codes WHERE id=?')
          .bind(id)
          .first<ClaimCode>())!,
      };
    } catch (error) {
      const concurrent = await db
        .prepare("SELECT * FROM claim_codes WHERE participant_id=? AND status!='expired'")
        .bind(participant.id)
        .first<ClaimCode>();
      if (concurrent && concurrent.expires_at > now) return { participant, claim: concurrent };
      if (!(error instanceof Error) || !/UNIQUE constraint/i.test(error.message)) throw error;
    }
  }
  throw new Error('code_generation_busy');
}
export function goUrl(base: string, gate: ClaimGate, code: string) {
  const url = new URL(`/c/${gate.slug}/go`, base);
  url.searchParams.set('c', code);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}
export function intentUrl(gate: ClaimGate, code: string, android: boolean) {
  const url = new URL('https://x.com/intent/post');
  let text = `${gate.claim_phrase}-${code} 参加します！${gate.reply_hashtag ? ' #' + gate.reply_hashtag.replace(/^#/, '') : ''}`;
  if (android) {
    text += ` @${gate.brand_username}`;
    url.searchParams.set('url', `https://x.com/${gate.brand_username}/status/${gate.post_id}`);
  } else url.searchParams.set('in_reply_to', gate.post_id);
  url.searchParams.set('text', text);
  return url.toString();
}
