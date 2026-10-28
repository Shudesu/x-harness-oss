import { readExternalSource, settleExternalGate } from './external-source.js';
import { getCampaignInventory } from "./campaign-status.js";
import { spendPressure } from "./spend-pressure.js";
import { getXAccountById } from "@x-harness/db";
import type { Env } from "../index.js";
import type { ClaimGate, ClaimCode, GateParticipant } from "./claim-types.js";
import { buildXClient } from "./x-client.js";
import { matchClaimPosts, compareTweetIds } from "./reply-code-matcher.js";
import { verifyClaimConditions } from "./claim-verify.js";
import { withGateLock, finalizeParticipant } from "./gate-rewards.js";
export function pollInterval(lastIssue: number, now = Date.now(), factor = 1) {
  const age = now - lastIssue;
  return Math.min(
    (age < 180000 ? 15000 : age < 1800000 ? 60000 : 300000) * factor,
    1800000,
  );
}
export async function pollClaimGate(
  env: Env["Bindings"],
  gateId: string,
  now = Date.now(),
  options: { skipSearch?: boolean; interactive?: boolean } = {},
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
    const external=await readExternalSource(db,gateId);
    if(external?.enabled) {
      await db.prepare('UPDATE engagement_gates SET last_code_check_at=? WHERE id=?').bind(now,gateId).run();
      return settleExternalGate(db,gate,external,owner,now);
    }
    if (gate.last_code_check_at && now - gate.last_code_check_at < 10000)
      return {
        pending: 1,
        retryAfterSec: Math.ceil(
          (10000 - now + gate.last_code_check_at) / 1000,
        ),
      };
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
      await db
        .prepare("UPDATE engagement_gates SET last_code_check_at=? WHERE id=?")
        .bind(now, gateId)
        .run();

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
    const pressure = await spendPressure(db, gateId);
    const interval = options.interactive
      ? 10000
      : pollInterval(gate.last_claim_at ?? now, now, pressure.factor);
    if (gate.last_code_check_at && now - gate.last_code_check_at < interval)
      return {
        pending: 1,
        retryAfterSec: Math.ceil(
          (interval - now + gate.last_code_check_at) / 1000,
        ),
      };
    await db
      .prepare("UPDATE engagement_gates SET last_code_check_at=? WHERE id=?")
      .bind(now, gateId)
      .run();

    if (pressure.factor > 1)
      await db
        .prepare(
          "INSERT OR IGNORE INTO gate_events(id,gate_id,type,at,meta,dedup_key) VALUES (?,?,'spend_backoff',?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          gateId,
          now,
          JSON.stringify({
            factor: pressure.factor,
            ratio: Math.max(pressure.month, pressure.gate),
          }),
          `backoff:${gateId}:${pressure.factor}:${new Date(now).toISOString().slice(0, 7)}`,
        )
        .run();
    const emptyInventory = await getCampaignInventory(db, gateId);
    if (
      gate.award_mode === "first_come" &&
      emptyInventory.remaining === 0 &&
      (gate.tier === "strict" ||
        gate.follow_policy === "verify_winners" ||
        gate.like_policy === "verify_winners")
    ) {
      const known = (
        await db
          .prepare(
            "SELECT * FROM claim_codes WHERE gate_id=? AND status='provisional' ORDER BY reply_created_at,LENGTH(reply_tweet_id),reply_tweet_id LIMIT 50",
          )
          .bind(gateId)
          .all<ClaimCode>()
      ).results;
      for (const claim of known) {
        if (now - (claim.matched_at ?? now) < gate.settle_sec * 1000) break;
        const p = await db
          .prepare("SELECT * FROM gate_participants WHERE id=?")
          .bind(claim.participant_id)
          .first<GateParticipant>();
        if (!p || p.finalized_at) continue;
        await db
          .prepare(
            "UPDATE gate_participants SET status='verified',x_user_id=?,x_username=? WHERE id=? AND finalized_at IS NULL",
          )
          .bind(claim.x_user_id, claim.x_username, p.id)
          .run();
        await finalizeParticipant(
          db,
          gate,
          {
            ...p,
            status: "verified",
            x_user_id: claim.x_user_id,
            x_username: claim.x_username,
          },
          owner,
          now,
          true,
        );
      }
      if (
        !(await db
          .prepare(
            "SELECT id FROM claim_codes WHERE gate_id=? AND status='awaiting_reply' LIMIT 1",
          )
          .bind(gateId)
          .first())
      )
        return {
          pending: (await count())?.total ?? 0,
          retryAfterSec: Math.ceil(
            pollInterval(gate.last_claim_at ?? now, now, pressure.factor) /
              1000,
          ),
        };
    }
    if (pressure.gate >= 1) {
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
      if (!options.skipSearch) {
        // Forward cursor is retained until pagination completes. A bounded overlapping
        // scan reconciles late indexing before settlement; it never rolls back prizes.
        const settling = await db
          .prepare(
            "SELECT id FROM gate_participants WHERE gate_id=? AND finalized_at IS NULL AND status IN ('provisional','verified','missing_conditions') LIMIT 1",
          )
          .bind(gateId)
          .first();
        const overlap =
          gate.scan_mode === "overlap" ||
          (!gate.scan_cursor &&
            pressure.overlapAllowed &&
            !!settling &&
            !!gate.last_reply_since_id &&
            (!gate.last_overlap_at ||
              now - gate.last_overlap_at >=
                Math.max(60000, gate.settle_sec * 1000)));
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
      }
      const inventory = await getCampaignInventory(db, gateId);
      const windowed =
        gate.award_mode === "first_come" &&
        !inventory.unlimited &&
        (gate.tier === "strict" ||
          gate.follow_policy === "verify_winners" ||
          gate.like_policy === "verify_winners");
      const claims = (
        await db
          .prepare(
            "SELECT c.* FROM claim_codes c JOIN gate_participants p ON p.id=c.participant_id WHERE c.gate_id=? AND c.status='provisional' AND (?=0 OR p.verify_attempts<3) ORDER BY c.reply_created_at,LENGTH(c.reply_tweet_id),c.reply_tweet_id LIMIT 50",
          )
          .bind(gateId, windowed && inventory.remaining !== 0 ? 1 : 0)
          .all<ClaimCode>()
      ).results;
      let slots = windowed ? (inventory.remaining ?? 0) : Infinity;
      let likesPromise:
        | Promise<{ ids: Set<string>; unverifiable: boolean }>
        | undefined;
      const likes = {
        load: () =>
          (likesPromise ??= (async () => {
            const page = await client.getLikingUsers(gate.post_id);
            return {
              ids: new Set((page.data ?? []).map((u) => u.id)),
              unverifiable:
                (page.data ?? []).length >= 100 || !!page.meta?.next_token,
            };
          })()),
      };
      for (const claim of claims) {
        if (Date.now() > deadline) break;
        if (now - (claim.matched_at ?? now) < gate.settle_sec * 1000) break;
        const participantBefore = await db
          .prepare("SELECT * FROM gate_participants WHERE id=?")
          .bind(claim.participant_id)
          .first<GateParticipant>();
        if (!participantBefore || participantBefore.finalized_at) continue;
        if (windowed) {
          const currentInventory = await getCampaignInventory(db, gateId);
          if (currentInventory.remaining === 0) {
            await db
              .prepare(
                "UPDATE gate_participants SET status='verified',x_user_id=?,x_username=? WHERE id=? AND finalized_at IS NULL",
              )
              .bind(claim.x_user_id, claim.x_username, claim.participant_id)
              .run();
            await finalizeParticipant(
              db,
              gate,
              {
                ...participantBefore,
                status: "verified",
                x_user_id: claim.x_user_id,
                x_username: claim.x_username,
              },
              owner,
              now,
              true,
            );
            continue;
          }
          if (participantBefore.verify_attempts >= 3) continue;
          if (slots <= 0) continue;
          slots--;
        }
        if (participantBefore.retry_at && participantBefore.retry_at > now)
          continue;
        const conditions = await verifyClaimConditions(
          db,
          client,
          gate,
          claim,
          now,
          likes,
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
                  "UPDATE gate_participants SET status='awaiting_reply',missing='[\"reply\"]',retry_at=NULL,verify_attempts=0 WHERE id=? AND finalized_at IS NULL",
                )
                .bind(claim.participant_id),
            ]);
            continue;
          }
          await db
            .prepare(
              "UPDATE gate_participants SET status=?,missing=?,retry_at=?,updated_at=?,verify_attempts=verify_attempts+CASE WHEN ?='pending_verify' THEN 0 ELSE 1 END WHERE id=? AND finalized_at IS NULL",
            )
            .bind(
              conditions.missing.includes("budget")
                ? "pending_verify"
                : "missing_conditions",
              JSON.stringify(conditions.missing),
              conditions.retryAt ?? now + 600000,
              now,
              conditions.missing.includes("budget")
                ? "pending_verify"
                : "missing_conditions",
              claim.participant_id,
            )
            .run();
          if (conditions.missing.includes("budget")) break;
          continue;
        }
        if (conditions.note)
          await db
            .prepare(
              "INSERT OR IGNORE INTO gate_events(id,gate_id,participant_id,type,at,dedup_key) VALUES (?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              gateId,
              claim.participant_id,
              conditions.note,
              now,
              `${conditions.note}:${claim.participant_id}`,
            )
            .run();
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
        pollInterval(gate.last_claim_at ?? now, now, pressure.factor) / 1000,
      ),
    };
  });
  return result ?? { pending: 1, retryAfterSec: 10 };
}
