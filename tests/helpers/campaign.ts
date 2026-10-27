import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { vi } from 'vitest';
export const now = Date.parse('2026-10-27T10:00:00Z');
export function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('packages/db/bootstrap').sort())
    sqlite.exec(readFileSync(`packages/db/bootstrap/${file}`, 'utf8'));
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
      sqlite.exec('BEGIN');
      try {
        const out = list.map((s) => s._run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
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
  const gate = sqlite.prepare("SELECT * FROM engagement_gates WHERE id='g'").get() as any;
  return { sqlite, db, gate };
}
