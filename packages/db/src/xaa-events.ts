import { jstNow } from './utils.js';

export interface DbXaaEvent {
  id: string;
  event_type: string;
  payload: string;
  received_at: string;
}

export async function insertXaaEvent(db: D1Database, eventType: string, payload: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO xaa_events (id, event_type, payload, received_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), eventType, JSON.stringify(payload), jstNow())
    .run();
}

export async function getXaaEvents(
  db: D1Database,
  options: { eventType?: string; limit?: number; offset?: number } = {},
): Promise<DbXaaEvent[]> {
  // Clamp to sane ranges — SQLite treats LIMIT -1 as "no limit"
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Math.floor(options.offset ?? 0) || 0, 0);
  if (options.eventType) {
    const result = await db
      .prepare('SELECT * FROM xaa_events WHERE event_type = ? ORDER BY received_at DESC LIMIT ? OFFSET ?')
      .bind(options.eventType, limit, offset)
      .all<DbXaaEvent>();
    return result.results;
  }
  const result = await db
    .prepare('SELECT * FROM xaa_events ORDER BY received_at DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<DbXaaEvent>();
  return result.results;
}
