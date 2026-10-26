import type { ClaimGate, ClaimCode, ClaimPost, ClaimAuthor } from './claim-types.js';
import { extractCodes, recordGateEvent } from './claim-codes.js';
import { outboxStatement } from './line-events.js';
export function compareTweetIds(a: string, b: string) {
  return a.length - b.length || a.localeCompare(b);
}
export function comparePosts(a: ClaimPost, b: ClaimPost) {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || compareTweetIds(a.id, b.id);
}
export function isCampaignPost(gate: ClaimGate, post: ClaimPost): boolean {
  if (post.referenced_tweets?.some((r) => r.type === 'retweeted')) return false;
  if (post.conversation_id === gate.post_id && post.id !== gate.post_id) return true;
  const brand = gate.brand_username.toLowerCase();
  const mentioned =
    post.entities?.mentions?.some((m) => m.username.toLowerCase() === brand) ||
    new RegExp('(?:^|[^A-Za-z0-9_])@' + brand + '(?![A-Za-z0-9_])', 'i').test(post.text);
  const urls = [
    ...(post.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url ?? ''),
    ...(post.text.match(/https?:\/\/[^\s]+/g) ?? []),
  ];
  const linked = urls.some((raw) => {
    try {
      const u = new URL(raw);
      return (
        ['x.com', 'twitter.com', 'www.x.com'].includes(u.hostname) &&
        new RegExp('/status/' + gate.post_id + '(?:/|$)').test(u.pathname)
      );
    } catch {
      return false;
    }
  });
  return !!(mentioned || linked);
}
export async function matchClaimPosts(
  db: D1Database,
  gate: ClaimGate,
  posts: ClaimPost[],
  authors: ClaimAuthor[],
  now = Date.now(),
): Promise<void> {
  const users = new Map(authors.map((a) => [a.id, a]));
  for (const post of [...posts]
    .filter((p) => /^\d+$/.test(p.id) && Number.isFinite(Date.parse(p.created_at)))
    .sort(comparePosts)) {
    if (
      await db
        .prepare('SELECT tweet_id FROM gate_reply_candidates WHERE gate_id=? AND tweet_id=?')
        .bind(gate.id, post.id)
        .first()
    )
      continue;
    const codes = extractCodes(post.text, gate.claim_phrase),
      author = users.get(post.author_id),
      created = Date.parse(post.created_at);
    let reason = 'matched';
    let claim: ClaimCode | null = null;
    if (!isCampaignPost(gate, post)) reason = 'wrong_campaign';
    else if (codes.length === 0) reason = 'reply_without_code';
    else if (codes.length !== 1) reason = 'multiple_codes';
    else {
      claim = await db
        .prepare('SELECT * FROM claim_codes WHERE gate_id=? AND code=?')
        .bind(gate.id, codes[0])
        .first<ClaimCode>();
      if (!claim) reason = 'unknown_code';
      else if (
        created < claim.issued_at ||
        created > claim.expires_at ||
        claim.status === 'expired'
      )
        reason = 'expired';
      else if (!author?.created_at || !Number.isFinite(Date.parse(author.created_at)))
        reason = 'author_unavailable';
      else if (created - Date.parse(author.created_at) < gate.min_account_age_days * 86400000)
        reason = 'account_too_new';
      else if (author.protected) reason = 'protected_account';
      else if (
        gate.tier === 'strict' &&
        (author.public_metrics?.followers_count ?? 0) < gate.min_followers
      )
        reason = 'followers_count';
      else if (!['awaiting_reply', 'provisional'].includes(claim.status)) reason = 'duplicate_code';
      else if (
        claim.status === 'provisional' &&
        (created > claim.reply_created_at! ||
          (created === claim.reply_created_at &&
            compareTweetIds(post.id, claim.reply_tweet_id!) >= 0))
      )
        reason = 'duplicate_code';
    }
    if (reason === 'matched' && claim && author) {
      try {
        await db.batch([
          db
            .prepare(
              "UPDATE claim_codes SET status='provisional',x_user_id=?,x_username=?,reply_tweet_id=?,reply_created_at=?,author_json=?,matched_at=?,reject_reason=NULL WHERE id=? AND status IN ('awaiting_reply','provisional')",
            )
            .bind(
              author.id,
              author.username,
              post.id,
              created,
              JSON.stringify(author),
              now,
              claim.id,
            ),
          db
            .prepare(
              "UPDATE gate_participants SET status='provisional',missing='[]',retry_at=NULL,updated_at=? WHERE id=? AND finalized_at IS NULL",
            )
            .bind(now, claim.participant_id),
          db
            .prepare(
              "INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,'reply_matched',?,?)",
            )
            .bind(
              crypto.randomUUID(),
              gate.id,
              claim.participant_id,
              now,
              `matched:${claim.participant_id}`,
            ),
          outboxStatement(
            db,
            gate.id,
            claim.participant_id,
            'x.gate.reply_matched',
            {
              schema: 'xh.gate.v1',
              gateId: gate.id,
              participantId: claim.participant_id,
              replyTweetId: post.id,
            },
            now,
          ),
        ]);
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint/.test(error.message))
          reason = 'x_already_used';
        else throw error;
      }
    }
    if (
      claim &&
      [
        'account_too_new',
        'x_already_used',
        'author_unavailable',
        'followers_count',
        'protected_account',
        'reply_deleted',
      ].includes(reason)
    ) {
      await db
        .prepare("UPDATE claim_codes SET reject_reason=? WHERE id=? AND status='awaiting_reply'")
        .bind(reason, claim.id)
        .run();
    }
    if (reason === 'author_unavailable') continue;
    await db
      .prepare(
        'INSERT OR IGNORE INTO gate_reply_candidates(gate_id,tweet_id,code,created_at,author_id,result,json) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(
        gate.id,
        post.id,
        codes.length === 1 ? codes[0] : null,
        created,
        claim ? post.author_id : '',
        reason,
        claim ? JSON.stringify(post) : '{}',
      )
      .run();
    if (reason !== 'matched')
      await recordGateEvent(
        db,
        gate.id,
        reason,
        claim?.participant_id ?? null,
        claim ? { tweetId: post.id } : {},
        `candidate:${gate.id}:${post.id}`,
      );
  }
}
