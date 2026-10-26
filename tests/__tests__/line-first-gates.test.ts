import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CODE_ALPHABET,
  randomCode,
  extractCodes,
  issueClaim,
} from "../../apps/worker/src/services/claim-codes.js";
import {
  matchClaimPosts,
  isCampaignPost,
} from "../../apps/worker/src/services/reply-code-matcher.js";
import {
  withGateLock,
  finalizeParticipant,
} from "../../apps/worker/src/services/gate-rewards.js";
import { buildXClient } from "../../apps/worker/src/services/x-client.js";
import { pollClaimGate } from "../../apps/worker/src/services/claim-poller.js";
import {
  signHarnessRequest,
  verifyHarnessRequest,
} from "../../apps/worker/src/services/harness-gate-protocol.js";
const now = Date.parse("2026-10-27T10:00:00Z");
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("packages/db/bootstrap").sort())
    sqlite.exec(readFileSync(`packages/db/bootstrap/${file}`, "utf8"));
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as any)) }),
    first: async () => sqlite.prepare(sql).get(...(values as any)) ?? null,
    run: async () => ({
      meta: { changes: sqlite.prepare(sql).run(...(values as any)).changes },
    }),
    _run: () => ({
      meta: { changes: sqlite.prepare(sql).run(...(values as any)).changes },
    }),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = list.map((s) => s._run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as any;
  sqlite.exec(
    "INSERT INTO x_accounts(id,x_user_id,username,access_token,created_at,updated_at) VALUES ('a','999','brand','fixture','2026-01-01','2026-01-01')",
  );
  sqlite
    .prepare(
      "INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at,gate_mode,slug,title,ends_at,claim_phrase,brand_username,gate_state) VALUES ('g','a','999','reply','verify_only','','2026-10-26','2026-10-26','line_first','spring','春の特典',?,'春プレ','brand','active')",
    )
    .run(new Date(now + 7 * 86400000).toISOString());
  const gate = sqlite
    .prepare("SELECT * FROM engagement_gates WHERE id='g'")
    .get() as any;
  return { sqlite, db, gate };
}
const author = (id: string) => ({
  id,
  username: `user${id}`,
  created_at: "2020-01-01T00:00:00Z",
  public_metrics: { followers_count: 10 },
});
const post = (code: string, id = "100", user = "10", at = now + 1000) => ({
  id,
  author_id: user,
  text: `春プレ-${code} 参加します`,
  created_at: new Date(at).toISOString(),
  conversation_id: "999",
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("LINE-first claim core", () => {
  it("uses the 31-symbol five-character alphabet and normalizes fullwidth replies", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    for (let i = 0; i < 50; i++)
      expect(randomCode()).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
    expect(extractCodes("春プレ－Ｋ７Ｑ２Ｍ 参加します", "春プレ")).toEqual([
      "K7Q2M",
    ]);
    expect(extractCodes("春プレ-K7Q2MX", "春プレ")).toEqual([]);
    expect(extractCodes("春プレ-K7Q2M 春プレ-AAAAA", "春プレ")).toHaveLength(2);
  });
  it("issues one live code under concurrent joins and retains expired history on renewal", async () => {
    const { db, sqlite, gate } = fixture();
    const issued = await Promise.all(
      Array.from({ length: 8 }, () => issueClaim(db, gate, "line-1", now)),
    );
    expect(new Set(issued.map((r) => r.claim!.code)).size).toBe(1);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM gate_participants").get()?.n,
    ).toBe(1);
    const later = await issueClaim(db, gate, "line-1", now + 73 * 3600000);
    expect(later.claim!.code).not.toBe(issued[0].claim!.code);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM claim_codes WHERE status='expired'")
        .get()?.n,
    ).toBe(1);
  });
  it("keeps the recipient fixed, picks the earlier original within settlement, and rejects one X used twice", async () => {
    const { db, sqlite, gate } = fixture();
    const a = await issueClaim(db, gate, "line-1", now),
      b = await issueClaim(db, gate, "line-2", now);
    await matchClaimPosts(
      db,
      gate,
      [post(a.claim!.code, "102", "20", now + 2000)],
      [author("20")],
      now + 3000,
    );
    await matchClaimPosts(
      db,
      gate,
      [post(a.claim!.code, "101", "10", now + 1000)],
      [author("10")],
      now + 4000,
    );
    expect(
      sqlite
        .prepare("SELECT x_user_id FROM claim_codes WHERE id=?")
        .get(a.claim!.id)?.x_user_id,
    ).toBe("10");
    expect(
      sqlite
        .prepare("SELECT line_friend_id FROM gate_participants WHERE id=?")
        .get(a.participant.id)?.line_friend_id,
    ).toBe("line-1");
    await matchClaimPosts(
      db,
      gate,
      [post(b.claim!.code, "103", "10", now + 2500)],
      [author("10")],
      now + 4500,
    );
    expect(
      sqlite
        .prepare("SELECT reject_reason FROM claim_codes WHERE id=?")
        .get(b.claim!.id)?.reject_reason,
    ).toBe("x_already_used");
  });
  it("rejects multiple codes, pre-issuance replies and too-new authors without consuming a valid code", async () => {
    const { db, sqlite, gate } = fixture();
    const a = await issueClaim(db, gate, "line-1", now);
    await matchClaimPosts(
      db,
      gate,
      [
        {
          ...post(a.claim!.code, "100"),
          text: `春プレ-${a.claim!.code} 春プレ-AAAAA`,
        },
      ],
      [author("10")],
      now + 5000,
    );
    await matchClaimPosts(
      db,
      gate,
      [post(a.claim!.code, "101", "10", now - 1000)],
      [author("10")],
      now + 5000,
    );
    await matchClaimPosts(
      db,
      gate,
      [post(a.claim!.code, "102")],
      [{ ...author("10"), created_at: new Date(now).toISOString() }],
      now + 5000,
    );
    expect(
      sqlite
        .prepare("SELECT status,reject_reason FROM claim_codes WHERE id=?")
        .get(a.claim!.id),
    ).toMatchObject({
      status: "awaiting_reply",
      reject_reason: "account_too_new",
    });
  });
  it("accepts the Android authored mention or expanded campaign URL, not reposts or unrelated posts", () => {
    const { gate } = fixture();
    expect(
      isCampaignPost(gate, {
        ...post("AAAAA"),
        conversation_id: undefined,
        text: "春プレ-AAAAA @brand",
      }),
    ).toBe(true);
    expect(
      isCampaignPost(gate, {
        ...post("AAAAA"),
        conversation_id: undefined,
        entities: {
          urls: [{ expanded_url: "https://x.com/brand/status/999" }],
        },
      }),
    ).toBe(true);
    expect(
      isCampaignPost(gate, {
        ...post("AAAAA"),
        conversation_id: undefined,
        text: "春プレ-AAAAA @brand_fake",
      }),
    ).toBe(false);
    expect(
      isCampaignPost(gate, {
        ...post("AAAAA"),
        referenced_tweets: [{ type: "retweeted", id: "1" }],
      }),
    ).toBe(false);
  });
  it("atomically reserves finite inventory and a unique coupon, and records notification outbox", async () => {
    const { db, sqlite, gate } = fixture();
    gate.tier = "simple";
    sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',1,'A賞','coupon_code','',1);INSERT INTO reward_codes(id,reward_id,code) VALUES ('coupon','r','SYNTHETIC-REWARD')",
    );
    const a = await issueClaim(db, gate, "line-1", now),
      b = await issueClaim(db, gate, "line-2", now);
    await withGateLock(db, "g", async (owner) => {
      await finalizeParticipant(db, gate, a.participant, owner, now);
      await finalizeParticipant(db, gate, b.participant, owner, now);
    });
    expect(
      sqlite.prepare("SELECT issued FROM gate_rewards WHERE id='r'").get()
        ?.issued,
    ).toBe(1);
    expect(
      sqlite
        .prepare("SELECT outcome FROM gate_participants WHERE id=?")
        .get(a.participant.id)?.outcome,
    ).toBe("won");
    expect(
      sqlite
        .prepare("SELECT outcome FROM gate_participants WHERE id=?")
        .get(b.participant.id)?.outcome,
    ).toBe("lost");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM event_outbox WHERE event='x.gate.reward_unlocked'",
        )
        .get()?.n,
    ).toBe(2);
  });
  it("rolls inventory and coupon assignment back when persisting the notification fails", async () => {
    const { db, sqlite, gate } = fixture();
    gate.tier = "simple";
    sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',1,'A','coupon_code','',1);INSERT INTO reward_codes(id,reward_id,code) VALUES ('c','r','SYNTHETIC');CREATE TRIGGER fail_outbox BEFORE INSERT ON event_outbox BEGIN SELECT RAISE(ABORT,'fixture_failure');END;",
    );
    const a = await issueClaim(db, gate, "line-1", now);
    await expect(
      withGateLock(db, "g", (owner) =>
        finalizeParticipant(db, gate, a.participant, owner, now),
      ),
    ).rejects.toThrow("fixture_failure");
    expect(
      sqlite.prepare("SELECT issued FROM gate_rewards WHERE id='r'").get()
        ?.issued,
    ).toBe(0);
    expect(
      sqlite
        .prepare(
          "SELECT assigned_participant_id FROM reward_codes WHERE id='c'",
        )
        .get()?.assigned_participant_id,
    ).toBeNull();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM gate_settlements").get()?.n,
    ).toBe(0);
  });
  it("binds signed claims to connection, body, method, timestamp and path", async () => {
    const secret = "synthetic-integration-secret-for-tests-only",
      path = "/api/integrations/line-harness/claims",
      body = '{"gateId":"g","lineFriendId":"f"}';
    const headers = await signHarnessRequest(
      secret,
      "POST",
      path,
      body,
      { connectionId: "connection", event: "line.gate.claim" },
      now,
    );
    const req = new Request("https://fixture.example" + path, {
      method: "POST",
      headers,
      body,
    });
    expect(
      await verifyHarnessRequest(secret, req, body, "connection", now),
    ).not.toBeNull();
    expect(
      await verifyHarnessRequest(secret, req, body + " ", "connection", now),
    ).toBeNull();
    expect(
      await verifyHarnessRequest(secret, req, body, "other", now),
    ).toBeNull();
    expect(
      await verifyHarnessRequest(secret, req, body, "connection", now + 300001),
    ).toBeNull();
  });
});

describe("polling and settlement ordering", () => {
  it("settles timestamp ties by numeric post ID and never awards beyond inventory", async () => {
    const { db, sqlite, gate } = fixture();
    sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',1,'Gift','line_message','Synthetic',1)",
    );
    const a = await issueClaim(db, gate, "line-a", now),
      b = await issueClaim(db, gate, "line-b", now);
    const replies = [
      post(a.claim!.code, "10002", "20"),
      post(b.claim!.code, "9999", "10"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: replies,
          includes: { users: [author("10"), author("20")] },
          meta: {},
        }),
      ),
    );
    vi.setSystemTime(now + 20000);
    await pollClaimGate({ DB: db } as any, "g");
    vi.setSystemTime(now + 90000);
    await pollClaimGate({ DB: db } as any, "g");
    expect(
      sqlite
        .prepare("SELECT outcome,rank FROM gate_participants WHERE id=?")
        .get(b.participant.id),
    ).toMatchObject({ outcome: "won", rank: 1 });
    expect(
      sqlite
        .prepare("SELECT outcome,rank FROM gate_participants WHERE id=?")
        .get(a.participant.id),
    ).toMatchObject({ outcome: "lost", rank: 2 });
    expect(
      sqlite.prepare("SELECT issued FROM gate_rewards WHERE id='r'").get()
        ?.issued,
    ).toBe(1);
  });
  it("holds a mature later reply when an earlier reply arrives during the settlement window", async () => {
    const { db, sqlite, gate } = fixture();
    sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',1,'Gift','line_message','Synthetic',1)",
    );
    const a = await issueClaim(db, gate, "line-a", now),
      b = await issueClaim(db, gate, "line-b", now);
    let replies = [post(b.claim!.code, "102", "20", now + 2000)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: replies,
          includes: { users: [author("10"), author("20")] },
          meta: {},
        }),
      ),
    );
    vi.setSystemTime(now + 10000);
    await pollClaimGate({ DB: db } as any, "g");
    replies = [post(a.claim!.code, "101", "10", now + 1000), ...replies];
    vi.setSystemTime(now + 65000);
    await pollClaimGate({ DB: db } as any, "g");
    vi.setSystemTime(now + 80000);
    await pollClaimGate({ DB: db } as any, "g");
    expect(
      sqlite.prepare("SELECT issued FROM gate_rewards WHERE id='r'").get()
        ?.issued,
    ).toBe(0);
    vi.setSystemTime(now + 126000);
    await pollClaimGate({ DB: db } as any, "g");
    expect(
      sqlite
        .prepare("SELECT outcome,rank FROM gate_participants WHERE id=?")
        .get(a.participant.id),
    ).toMatchObject({ outcome: "won", rank: 1 });
  });
  it("preserves the overlapping search window across pages and does not roll the forward cursor back", async () => {
    const { db, sqlite, gate } = fixture();
    await issueClaim(db, gate, "line-a", now);
    sqlite.exec("UPDATE engagement_gates SET last_reply_since_id='1005'");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return Response.json({
          data: [],
          meta: urls.length === 1 ? { next_token: "page-two" } : {},
        });
      }),
    );
    vi.setSystemTime(now + 20000);
    await pollClaimGate({ DB: db } as any, "g");
    vi.setSystemTime(now + 40000);
    await pollClaimGate({ DB: db } as any, "g");
    expect(new URL(urls[0]).searchParams.get("start_time")).toBe(
      new URL(urls[1]).searchParams.get("start_time"),
    );
    expect(new URL(urls[1]).searchParams.get("next_token")).toBe("page-two");
    expect(new URL(urls[0]).searchParams.get("query")).toContain("url:999");
    expect(
      sqlite
        .prepare(
          "SELECT last_reply_since_id FROM engagement_gates WHERE id='g'",
        )
        .get()?.last_reply_since_id,
    ).toBe("1005");
  });
  it("keeps a budget-held claim pending without calling X", async () => {
    const { db, sqlite, gate } = fixture();
    await issueClaim(db, gate, "line-a", now);
    sqlite.exec("UPDATE engagement_gates SET budget_usd=0");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await pollClaimGate({ DB: db } as any, "g")).retryAfterSec).toBe(
      300,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT status FROM gate_participants").get()?.status,
    ).toBe("pending_verify");
  });
});

it("preserves historical deliveries and only pauses unsafe legacy paths on upgrade", () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("packages/db/bootstrap")
    .sort()
    .filter((f) => !f.startsWith("020-")))
    sqlite.exec(readFileSync(`packages/db/bootstrap/${file}`, "utf8"));
  for (const [id, trigger, action, link] of [
    ["safe", "reply", "mention_post", ""],
    ["public", "reply", "mention_post", "https://example.test/gift"],
    ["unsolicited", "like", "mention_post", ""],
    ["dm", "reply", "dm", ""],
    ["form", "reply", "verify_only", ""],
  ])
    sqlite
      .prepare(
        "INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,link,created_at,updated_at) VALUES (?,'a','123',?,?,?,?,'2020','2020')",
      )
      .run(id, trigger, action, "Thanks", link);
  sqlite.exec(
    "INSERT INTO engagement_gate_deliveries(id,gate_id,x_user_id,token,status,created_at) VALUES ('old','public','user','legacy-token','delivered','2020')",
  );
  sqlite.exec(
    readFileSync("packages/db/migrations/020-line-first-gates.sql", "utf8"),
  );
  expect(
    sqlite
      .prepare("SELECT id FROM engagement_gates WHERE is_active=1 ORDER BY id")
      .all()
      .map((r) => r.id),
  ).toEqual(["form", "safe"]);
  expect(
    sqlite
      .prepare("SELECT token,status,expires_at FROM engagement_gate_deliveries")
      .get(),
  ).toMatchObject({
    token: "legacy-token",
    status: "delivered",
    expires_at: null,
  });
  expect(sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe(
    "ok",
  );
  sqlite.close();
});
it("keeps participant and competitor posts out of the owned-post cache while metering their reads", async () => {
  const { db, sqlite } = fixture();
  const account = sqlite
    .prepare("SELECT * FROM x_accounts WHERE id='a'")
    .get() as any;
  const client = await buildXClient({ DB: db } as any, account, "claim:g");
  let id = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: [{ id: String(++id), text: "synthetic" }] }),
    ),
  );
  await client.searchClaimReplies("conversation_id:999", {});
  await client.getUserTweets("other-user");
  await client.getTweets(["1"]);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM post_cache").get()?.n).toBe(0);
  await client.getUserTweets("999");
  expect(sqlite.prepare("SELECT COUNT(*) n FROM post_cache").get()?.n).toBe(1);
  expect(
    Number(sqlite.prepare("SELECT COUNT(*) n FROM api_spend_ledger").get()?.n),
  ).toBeGreaterThanOrEqual(4);
});
