import { readExternalSource } from './external-source.js';
import { getXAccountById } from '@x-harness/db';
import type { Env } from '../index.js';
import type { ClaimGate, ClaimPost } from './claim-types.js';
import { buildXClient } from './x-client.js';
import { matchClaimPosts, compareTweetIds, isCampaignPost } from './reply-code-matcher.js';
import { extractCodes } from './claim-codes.js';
import { withGateLock } from './gate-rewards.js';
import { pollClaimGate, pollInterval } from './claim-poller.js';
import { spendPressure } from './spend-pressure.js';
export function buildBatchQueries(
  gates: ClaimGate[],
  maxLength = 512,
): Array<{ query: string; gateIds: string[] }> {
  const output: Array<{ query: string; gateIds: string[] }> = [];
  let parts: string[] = [],
    ids: string[] = [];
  const format = (p: string[]) => `(${p.join(' OR ')}) -is:retweet`;
  for (const g of gates) {
    const phrase = g.claim_phrase.replace(/["\\]/g, '');
    const term = `(conversation_id:${g.post_id} OR (@${g.brand_username} "${phrase}") OR (url:${g.post_id} "${phrase}"))`;
    if (format([term]).length > maxLength) throw new Error('gate_query_too_long');
    if (parts.length && format([...parts, term]).length > maxLength) {
      output.push({ query: format(parts), gateIds: ids });
      parts = [];
      ids = [];
    }
    parts.push(term);
    ids.push(g.id);
  }
  if (parts.length) output.push({ query: format(parts), gateIds: ids });
  return output;
}
export function routeBatchPosts(gates: ClaimGate[], posts: ClaimPost[]) {
  const result = new Map(gates.map((g) => [g.id, [] as ClaimPost[]]));
  for (const p of posts) {
    const direct = gates.filter(
      (g) =>
        p.conversation_id === g.post_id ||
        p.referenced_tweets?.some(
          (r) => ['replied_to', 'quoted'].includes(r.type) && r.id === g.post_id,
        ),
    );
    const targets = direct.length
      ? direct
      : gates.filter(
          (g) => isCampaignPost(g, p) && extractCodes(p.text, g.claim_phrase).length > 0,
        );
    for (const g of targets) result.get(g.id)!.push(p);
  }
  return result;
}
interface Cursor {
  since_id: string | null;
  scan_cursor: string | null;
  scan_newest_id: string | null;
  scan_mode: string | null;
  scan_start_at: string | null;
  last_overlap_at: number | null;
  gate_set_hash: string | null;
  gate_ids: string;
  query_index: number;
  queries: string | null;
  updated_at: number;
}
export async function pollAccountGates(
  env: Env['Bindings'],
  accountId: string,
  now = Date.now(),
  interactive = false,
) {
  const db = env.DB;
  if (
    (
      await db
        .prepare("SELECT value FROM settings WHERE key='claim_batch_search'")
        .first<{ value: string }>()
    )?.value !== 'true'
  )
    return { pending: 0, retryAfterSec: 0 };
  const owner = crypto.randomUUID();
  if (
    !(await db
      .prepare(
        'INSERT INTO claim_search_cursors(x_account_id,updated_at,lease_owner,lease_until) VALUES (?,?,?,?) ON CONFLICT(x_account_id) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until WHERE lease_until IS NULL OR lease_until<? RETURNING x_account_id',
      )
      .bind(accountId, 0, owner, now + 300000, now)
      .first())
  )
    return { pending: 1, retryAfterSec: 30 };
  try {
    const cursor = (await db
      .prepare('SELECT * FROM claim_search_cursors WHERE x_account_id=?')
      .bind(accountId)
      .first<Cursor>())!;
    let gates = (
      await db
        .prepare(
          "SELECT * FROM engagement_gates g WHERE x_account_id=? AND NOT EXISTS(SELECT 1 FROM gate_external_sources es WHERE es.gate_id=g.id AND es.enabled=1) AND gate_mode='line_first' AND tier!='simple' AND gate_state='active' AND is_active=1 AND archived_at IS NULL AND EXISTS(SELECT 1 FROM claim_codes cc WHERE cc.gate_id=g.id AND cc.status IN ('awaiting_reply','provisional','matched')) ORDER BY id",
        )
        .bind(accountId)
        .all<ClaimGate>()
    ).results;
    if (!gates.length) return { pending: 0, retryAfterSec: 0 };
    const pressures = await Promise.all(gates.map((g) => spendPressure(db, g.id)));
    if (pressures.some((p) => p.month >= 1))
      await db
        .prepare(
          "INSERT INTO settings(key,value,updated_at) VALUES ('budget_paused_at',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .bind(new Date(now).toISOString(), new Date(now).toISOString())
        .run();
    gates = gates.filter((_, i) => pressures[i].gate < 1 && pressures[i].month < 1);
    if (!gates.length) return { pending: 1, retryAfterSec: 300 };
    const factor = Math.max(...pressures.map((p) => p.factor)),
      interval = interactive
        ? 10000
        : Math.min(...gates.map((g) => pollInterval(g.last_claim_at ?? now, now, factor)));
    if (cursor.updated_at && now - cursor.updated_at < (cursor.queries ? 15000 : interval))
      return {
        pending: 1,
        retryAfterSec: Math.ceil(
          ((cursor.queries ? 15000 : interval) - now + cursor.updated_at) / 1000,
        ),
      };
    const gateIds = gates.map((g) => g.id),
      setHash = JSON.stringify(gateIds),
      oldIds = JSON.parse(cursor.gate_ids) as string[];
    if (cursor.since_id && cursor.gate_set_hash !== setHash) {
      for (const gate of gates.filter((g) => !oldIds.includes(g.id))) {
        await pollClaimGate(env, gate.id, now);
        const incomplete = await db
          .prepare('SELECT scan_cursor FROM engagement_gates WHERE id=?')
          .bind(gate.id)
          .first<{ scan_cursor: string | null }>();
        if (incomplete?.scan_cursor) return { pending: 1, retryAfterSec: 15 };
      }
    }
    // Restart the bounded scan if the gate set changed. Never reuse a token with
    // a different query; forward progress is committed only after all shards.
    const changed = cursor.gate_set_hash !== setHash;
    const queries =
      changed || !cursor.queries
        ? buildBatchQueries(gates)
        : (JSON.parse(cursor.queries) as ReturnType<typeof buildBatchQueries>);
    const index = changed ? 0 : cursor.query_index,
      query = queries[index];
    const settling = await db
      .prepare(
        "SELECT p.id FROM gate_participants p JOIN engagement_gates g ON g.id=p.gate_id WHERE g.x_account_id=? AND p.finalized_at IS NULL AND p.status IN ('provisional','verified','missing_conditions') LIMIT 1",
      )
      .bind(accountId)
      .first();
    const resuming = !changed && !!cursor.queries;
    const overlap = resuming
      ? cursor.scan_mode === 'overlap'
      : !!cursor.since_id &&
        !!settling &&
        pressures.every((p) => p.overlapAllowed) &&
        (!cursor.last_overlap_at ||
          now - cursor.last_overlap_at >=
            Math.max(60000, ...gates.map((g) => g.settle_sec * 1000)));
    const startTime =
      resuming && cursor.scan_start_at
        ? cursor.scan_start_at
        : new Date(
            overlap
              ? now - 600000
              : Math.max(
                  now - 6 * 86400000,
                  Math.min(...gates.map((g) => Date.parse(g.created_at))),
                ),
          ).toISOString();
    const account = await getXAccountById(db, accountId);
    if (!account) throw new Error('account_unavailable');
    const feature = `claim-batch:${crypto.randomUUID()}`,
      client = await buildXClient(env, account, feature);
    let page: Awaited<ReturnType<typeof client.searchClaimReplies>>;
    try {
      page = await client.searchClaimReplies(query.query, {
        nextToken: resuming ? (cursor.scan_cursor ?? undefined) : undefined,
        ...(overlap || !cursor.since_id ? { startTime } : { sinceId: cursor.since_id }),
      });
    } finally {
      // Split actual metered units evenly across this query's campaigns, retaining
      // the original total. This is attribution, not an asserted billing saving.
      const rows = (
        await db
          .prepare('SELECT * FROM api_spend_ledger WHERE feature=?')
          .bind(feature)
          .all<Record<string, any>>()
      ).results;
      for (const row of rows) {
        const n = query.gateIds.length;
        const batch = [
          db
            .prepare('UPDATE api_spend_ledger SET feature=?,units=?,cost_usd=? WHERE id=?')
            .bind(`claim:${query.gateIds[0]}`, row.units / n, row.cost_usd / n, row.id),
        ];
        for (const id of query.gateIds.slice(1))
          batch.push(
            db
              .prepare(
                'INSERT INTO api_spend_ledger(id,date_utc,x_account_id,feature,endpoint,resource_type,units,unit_cost_usd,cost_usd,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                crypto.randomUUID(),
                row.date_utc,
                row.x_account_id,
                `claim:${id}`,
                row.endpoint,
                row.resource_type,
                row.units / n,
                row.unit_cost_usd,
                row.cost_usd / n,
                row.source,
                row.created_at,
              ),
          );
        await db.batch(batch);
      }
    }
    const routed = routeBatchPosts(gates, page.data ?? []);
    for (const gate of gates.filter((g) => query.gateIds.includes(g.id))) {
      const matched = await withGateLock(db, gate.id, async () => {
        if((await readExternalSource(db,gate.id))?.enabled)return true;
        await matchClaimPosts(db, gate, routed.get(gate.id) ?? [], page.includes?.users ?? [], now);
        return true;
      });
      if (!matched) return { pending: 1, retryAfterSec: 15 };
    }
    const newest =
      [
        cursor.since_id,
        changed ? null : cursor.scan_newest_id,
        ...(page.data ?? []).map((p) => p.id),
      ]
        .filter((v): v is string => !!v)
        .sort(compareTweetIds)
        .at(-1) ?? null;
    const nextIndex = page.meta?.next_token ? index : index + 1,
      complete = nextIndex >= queries.length;
    await db
      .prepare(
        'UPDATE claim_search_cursors SET since_id=?,scan_cursor=?,scan_newest_id=?,scan_mode=?,scan_start_at=?,last_overlap_at=?,gate_set_hash=?,gate_ids=?,query_index=?,queries=?,updated_at=? WHERE x_account_id=? AND lease_owner=?',
      )
      .bind(
        complete && !overlap ? newest : cursor.since_id,
        complete ? null : (page.meta?.next_token ?? null),
        complete ? null : newest,
        complete ? null : overlap ? 'overlap' : 'forward',
        complete ? null : startTime,
        complete && overlap ? now : cursor.last_overlap_at,
        setHash,
        JSON.stringify(gateIds),
        complete ? 0 : nextIndex,
        complete ? null : JSON.stringify(queries),
        now,
        accountId,
        owner,
      )
      .run();
    if (!complete) return { pending: 1, retryAfterSec: 15 };
    let pending = 0;
    for (const gate of gates) {
      const result = await pollClaimGate(env, gate.id, now, { skipSearch: true });
      pending += result.pending;
    }
    return { pending, retryAfterSec: Math.ceil(interval / 1000) };
  } finally {
    await db
      .prepare(
        'UPDATE claim_search_cursors SET lease_owner=NULL,lease_until=NULL WHERE x_account_id=? AND lease_owner=?',
      )
      .bind(accountId, owner)
      .run();
  }
}
