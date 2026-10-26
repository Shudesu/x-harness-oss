import { getXAccountById } from "@x-harness/db";
import type { Env } from "../index.js";
import type { ClaimGate, ClaimCode, GateParticipant } from "./claim-types.js";
import { buildXClient } from "./x-client.js";
import { matchClaimPosts, compareTweetIds } from "./reply-code-matcher.js";
import { gateSpend, verifyClaimConditions } from "./claim-verify.js";
import { withGateLock, finalizeParticipant } from "./gate-rewards.js";
export function pollInterval(lastIssue: number, now = Date.now()) {
  const age = now - lastIssue;
  return age < 180000 ? 15000 : age < 1800000 ? 60000 : 300000;
}
export async function pollClaimGate(
  env: Env["Bindings"],
  gateId: string,
  now = Date.now(),
): Promise<{ pending: number; retryAfterSec: number }> {
  const db = env.DB;
  const result = await withGateLock(db, gateId, async (owner) => {
    const gate = await db
      .prepare(
        "SELECT * FROM engagement_gates WHERE id=? AND gate_mode='line_first'",
      )
      .bind(gateId)
      .first<ClaimGate>();
    if (!gate || !gate.is_active || gate.gate_state !== "active")
      return { pending: 0, retryAfterSec: 0 };
    if (gate.last_code_check_at && now - gate.last_code_check_at < 10000)
      return {
        pending: 1,
        retryAfterSec: Math.ceil(
          (10000 - now + gate.last_code_check_at) / 1000,
        ),
      };
    await db
      .prepare("UPDATE engagement_gates SET last_code_check_at=? WHERE id=?")
      .bind(now, gateId)
      .run();
    await db.batch([
      db
        .prepare(
          "UPDATE gate_participants SET status='expired' WHERE gate_id=? AND finalized_at IS NULL AND EXISTS(SELECT 1 FROM claim_codes c WHERE c.participant_id=gate_participants.id AND c.status='awaiting_reply' AND c.expires_at<=?)",
        )
        .bind(gateId, now),
      db
        .prepare(
          "UPDATE claim_codes SET status='expired' WHERE gate_id=? AND status='awaiting_reply' AND expires_at<=?",
        )
        .bind(gateId, now),
    ]);
    const simple = (
      await db
        .prepare(
          "SELECT * FROM gate_participants WHERE gate_id=? AND status='verified' AND finalized_at IS NULL ORDER BY created_at,id LIMIT 50",
        )
        .bind(gateId)
        .all<GateParticipant>()
    ).results;
    if (gate.tier === "simple") {
      for (const participant of simple)
        await finalizeParticipant(db, gate, participant, owner, now);
      const remaining = await db
        .prepare(
          "SELECT COUNT(*) AS total FROM gate_participants WHERE gate_id=? AND finalized_at IS NULL",
        )
        .bind(gateId)
        .first<{ total: number }>();
      return { pending: remaining?.total ?? 0, retryAfterSec: 15 };
    }
    const count = () =>
      db
        .prepare(
          "SELECT COUNT(*) AS total FROM claim_codes WHERE gate_id=? AND status IN ('awaiting_reply','provisional','matched')",
        )
        .bind(gateId)
        .first<{ total: number }>();
    if (!(await count())?.total) return { pending: 0, retryAfterSec: 0 };
    if ((await gateSpend(db, gateId)) >= gate.budget_usd) {
      await db
        .prepare(
          "UPDATE gate_participants SET status='pending_verify',retry_at=? WHERE gate_id=? AND finalized_at IS NULL",
        )
        .bind(now + 300000, gateId)
        .run();
      return { pending: 1, retryAfterSec: 300 };
    }
    const account = await getXAccountById(db, gate.x_account_id);
    if (!account) throw new Error("account_unavailable");
    const client = await buildXClient(env, account, `claim:${gate.id}`),
      deadline = Date.now() + 45000;
    try {
      // Forward cursor is retained until pagination completes. A bounded overlapping
      // scan reconciles late indexing before settlement; it never rolls back prizes.
      const overlap =
        gate.scan_mode === "overlap" ||
        (!gate.scan_cursor &&
          !!gate.last_reply_since_id &&
          (!gate.last_overlap_at || now - gate.last_overlap_at >= 60000));
      const phrase = gate.claim_phrase.replace(/["\\]/g, "");
      const query = `(conversation_id:${gate.post_id} OR (@${gate.brand_username} "${phrase}") OR (url:${gate.post_id} "${phrase}")) -is:retweet`;
      const firstIssue =
        (
          await db
            .prepare(
              "SELECT MIN(issued_at) AS at FROM claim_codes WHERE gate_id=? AND status IN ('awaiting_reply','provisional','matched')",
            )
            .bind(gateId)
            .first<{ at: number | null }>()
        )?.at ?? now;
      const startTime =
        gate.scan_cursor && gate.scan_start_at
          ? gate.scan_start_at
          : new Date(
              overlap
                ? Math.max(now - 10 * 60000, Date.parse(gate.created_at))
                : Math.max(firstIssue, now - 6 * 86400000),
            ).toISOString();
      const page = await client.searchClaimReplies(query, {
        nextToken: gate.scan_cursor ?? undefined,
        ...(overlap
          ? { startTime }
          : gate.last_reply_since_id
            ? { sinceId: gate.last_reply_since_id }
            : { startTime }),
      });
      await matchClaimPosts(
        db,
        gate,
        page.data ?? [],
        page.includes?.users ?? [],
        now,
      );
      const newest =
        [
          gate.last_reply_since_id,
          gate.scan_newest_id,
          ...(page.data ?? []).map((p) => p.id),
        ]
          .filter((v): v is string => !!v)
          .sort(compareTweetIds)
          .at(-1) ?? gate.last_reply_since_id;
      if (page.meta?.next_token) {
        await db
          .prepare(
            "UPDATE engagement_gates SET scan_cursor=?,scan_newest_id=?,scan_mode=?,scan_start_at=? WHERE id=?",
          )
          .bind(
            page.meta.next_token,
            newest,
            overlap ? "overlap" : "forward",
            overlap || !gate.last_reply_since_id ? startTime : null,
            gateId,
          )
          .run();
        return { pending: 1, retryAfterSec: 15 };
      }
      await db
        .prepare(
          "UPDATE engagement_gates SET scan_cursor=NULL,scan_newest_id=NULL,scan_mode=NULL,scan_start_at=NULL,last_reply_since_id=?,last_overlap_at=CASE WHEN ? THEN ? ELSE last_overlap_at END WHERE id=?",
        )
        .bind(
          overlap ? gate.last_reply_since_id : newest,
          overlap ? 1 : 0,
          now,
          gateId,
        )
        .run();
      const claims = (
        await db
          .prepare(
            "SELECT * FROM claim_codes WHERE gate_id=? AND status='provisional' ORDER BY reply_created_at,LENGTH(reply_tweet_id),reply_tweet_id LIMIT 50",
          )
          .bind(gateId)
          .all<ClaimCode>()
      ).results;
      for (const claim of claims) {
        if (Date.now() > deadline) break;
        if (now - (claim.matched_at ?? now) < gate.settle_sec * 1000) break;
        const conditions = await verifyClaimConditions(
          db,
          client,
          gate,
          claim,
          now,
        );
        if (!conditions.ok) {
          if (conditions.missing.includes("reply_deleted")) {
            await db.batch([
              db
                .prepare(
                  "UPDATE claim_codes SET status='awaiting_reply',x_user_id=NULL,x_username=NULL,reply_tweet_id=NULL,reply_created_at=NULL,author_json=NULL,matched_at=NULL,reject_reason='reply_deleted' WHERE id=?",
                )
                .bind(claim.id),
              db
                .prepare(
                  "UPDATE gate_participants SET status='awaiting_reply',missing='[\"reply\"]',retry_at=NULL WHERE id=? AND finalized_at IS NULL",
                )
                .bind(claim.participant_id),
            ]);
            continue;
          }
          await db
            .prepare(
              "UPDATE gate_participants SET status=?,missing=?,retry_at=?,updated_at=? WHERE id=? AND finalized_at IS NULL",
            )
            .bind(
              conditions.missing.includes("budget")
                ? "pending_verify"
                : "missing_conditions",
              JSON.stringify(conditions.missing),
              conditions.retryAt ?? now + 600000,
              now,
              claim.participant_id,
            )
            .run();
          if (conditions.missing.includes("budget")) break;
          continue;
        }
        await db
          .prepare(
            "UPDATE gate_participants SET status='verified',x_user_id=?,x_username=?,verified_at=?,missing='[]',retry_at=NULL WHERE id=? AND finalized_at IS NULL",
          )
          .bind(claim.x_user_id, claim.x_username, now, claim.participant_id)
          .run();
        const participant = (await db
          .prepare("SELECT * FROM gate_participants WHERE id=?")
          .bind(claim.participant_id)
          .first<GateParticipant>())!;
        await finalizeParticipant(db, gate, participant, owner, now);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "BudgetExceededError") {
        await db
          .prepare(
            "UPDATE gate_participants SET status='pending_verify',retry_at=? WHERE gate_id=? AND finalized_at IS NULL",
          )
          .bind(now + 300000, gateId)
          .run();
      } else throw error;
    }
    return {
      pending: (await count())?.total ?? 0,
      retryAfterSec: Math.ceil(
        pollInterval(gate.last_claim_at ?? now, now) / 1000,
      ),
    };
  });
  return result ?? { pending: 1, retryAfterSec: 10 };
}
