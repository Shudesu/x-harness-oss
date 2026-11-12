export interface RawSqlite {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
}
export function sqliteD1(setupSql?: string[]): { d1: D1Database; raw: RawSqlite };
export function readRepoFile(relPath: string): string;
export function readBootstrapSql(): string[];
