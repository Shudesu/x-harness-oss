/**
 * Converts a migration file into input accepted by D1Database.exec while
 * preserving trigger bodies, whose internal statements also end in `;`.
 */
export function compileMigrationForD1Exec(sql: string): string {
  const statements: string[] = [];
  let current = '';
  let inTrigger = false;

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^CREATE TRIGGER\b/.test(line)) inTrigger = true;
    current += `${line} `;
    if ((!inTrigger && line.endsWith(';')) || (inTrigger && line === 'END;')) {
      statements.push(current.trim());
      current = '';
      inTrigger = false;
    }
  }

  if (current.trim()) throw new Error('Migration contains an unterminated SQL statement');
  return statements.join('\n');
}
