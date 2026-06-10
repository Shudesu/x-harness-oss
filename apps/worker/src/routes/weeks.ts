//202606新規追加
import { Hono } from 'hono';
import type { Env } from '../index.js';

export const weeks = new Hono<Env>();

weeks.post('/api/weeks/bulk', async (c) => {
  const { xAccountId, items } = await c.req.json();

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `DELETE FROM scheduled_weeks WHERE x_account_id = ?`
  ).bind(xAccountId).run();

  const stmt = c.env.DB.prepare(`
    INSERT INTO scheduled_weeks (
      id,
      x_account_id,
      weekday,
      time,
      offset,
      timezone,
      text,
      sort_order,
      enabled,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    await stmt.bind(
      item.id,
      xAccountId,
      item.weekday,
      item.time,
      item.offset,
      item.timezone,
      item.text,
      item.sortOrder ?? 0,
      item.enabled ? 1 : 0,
      now,
      now
    ).run();
  }

    return c.json({ success: true });
});

//202606新規終了