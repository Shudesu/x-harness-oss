import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {processEngagementGates,deliverGate} from '../../apps/worker/src/services/engagement-gate.js';
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

afterEach(()=>vi.useRealTimers());
it('stops legacy mention gates configured for DM before polling or sending',async()=>{
 const f=fixture();f.sqlite.exec("UPDATE engagement_gates SET gate_mode='legacy',action_type='mention_post',delivery_method='dm',trigger_type='reply',link='',is_active=1");
 const client={sendDm:vi.fn(),createTweet:vi.fn(),searchRecentTweets:vi.fn()};
 await processEngagementGates(f.db,client as any,'a',true);
 expect(f.sqlite.prepare("SELECT is_active,pause_reason FROM engagement_gates WHERE id='g'").get()).toMatchObject({is_active:0,pause_reason:'legacy_delivery_requires_migration'});
 expect(client.sendDm).not.toHaveBeenCalled();expect(client.createTweet).not.toHaveBeenCalled();expect(client.searchRecentTweets).not.toHaveBeenCalled();
});
it('never falls back to a public reply when a legacy DM is refused',async()=>{
 const client={sendDm:vi.fn().mockRejectedValue(Object.assign(new Error('refused'),{status:403})),createTweet:vi.fn()};
 await expect(deliverGate(client as any,{action_type:'mention_post',delivery_method:'dm',link:''} as any,'123','fixture','Synthetic')).rejects.toThrow('skipped_dm_refused');
 expect(client.createTweet).not.toHaveBeenCalled();
});
it('preserves ambiguous DM errors without creating a second message',async()=>{
 const client={sendDm:vi.fn().mockRejectedValue(new Error('timeout')),createTweet:vi.fn()};
 await expect(deliverGate(client as any,{action_type:'mention_post',delivery_method:'dm',link:''} as any,'123','fixture','Synthetic')).rejects.toThrow('timeout');expect(client.createTweet).not.toHaveBeenCalled();
});
