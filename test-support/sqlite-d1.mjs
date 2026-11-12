// Test-only helpers (plain JS so package tsconfigs need no Node/sqlite types).
// sqliteD1() adapts an in-memory node:sqlite database to the subset of the
// D1Database API our query helpers use, so tests run against real SQL.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Statements that return rows (D1 first() reads them; writes return null).
const READS = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b|\bRETURNING\b/i;
// node:sqlite rows have a null prototype; tests compare plain objects.
const plain = (row) => (row ? { ...row } : row);

export function readRepoFile(relPath) {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// Fresh-install schema: every packages/db/bootstrap/*.sql in order.
export function readBootstrapSql() {
  const dir = new URL('../packages/db/bootstrap/', import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, dir), 'utf8'));
}

export function sqliteD1(setupSql = []) {
  const raw = new DatabaseSync(':memory:');
  for (const sql of setupSql) raw.exec(sql);
  const makeStmt = (sql, args) => ({
    _sql: sql,
    _args: args,
    bind: (...next) => makeStmt(sql, next),
    first: async () => {
      const st = raw.prepare(sql);
      if (!READS.test(sql)) {
        st.run(...args);
        return null;
      }
      return plain(st.get(...args)) ?? null;
    },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(plain), success: true, meta: {} }),
    run: async () => {
      const info = raw.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }, results: [] };
    },
  });
  // D1 batch(): all statements in one transaction (rolls back on error).
  const batch = async (stmts) => {
    raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => {
        const info = raw.prepare(s._sql).run(...s._args);
        return { success: true, meta: { changes: Number(info.changes) }, results: [] };
      });
      raw.exec('COMMIT');
      return out;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  };
  return { d1: { prepare: (sql) => makeStmt(sql, []), batch }, raw };
}
