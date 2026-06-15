//202606新規追加
import { Hono } from 'hono';
import type { Env } from '../index.js';

//20260614新規追加開始
import { calculateNextWeeklyRunAt } from '../services/week-schedule-time.js';
//20260614新規追加終了
export const weeks = new Hono<Env>();
//0612追加開始
weeks.get('/api/weeks', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  if (!xAccountId) {
    return c.json({ success: false, error: 'Missing required query param: xAccountId' }, 400);
  }

  const result = await c.env.DB.prepare(`
    SELECT
      id,
      x_account_id,
      enabled,
      sort_order,
      weekday,
      time,
      offset,
      timezone,
      text,
      next_run_at,
      last_posted_at,
      created_at,
      updated_at
    FROM scheduled_weeks
    WHERE x_account_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).bind(xAccountId).all<{
    id: string;
    x_account_id: string;
    enabled: number;
    sort_order: number;
    weekday: number;
    time: string;
    offset: number;
    timezone: string;
    text: string;
    next_run_at: string | null;
    last_posted_at: string | null;
    created_at: string;
    updated_at: string;
  }>();

  return c.json({
    success: true,
    data: result.results.map((item) => ({
      id: item.id,
      xAccountId: item.x_account_id,
      enabled: item.enabled === 1,
      sortOrder: item.sort_order,
      weekday: String(item.weekday),
      time: item.time,
      offset: String(item.offset),
      timezone: item.timezone,
      text: item.text,
      nextRunAt: item.next_run_at,
      lastPostedAt: item.last_posted_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  });
});
//0612追加終了
weeks.post('/api/weeks/bulk', async (c) => {

  //0612修正開始
  const { xAccountId, items } = await c.req.json();

    if (!xAccountId || !Array.isArray(items)) {
      return c.json(
        { success: false, error: 'Missing required fields: xAccountId, items' },
        400
      );
    }

    if (items.length > 50) {
      return c.json(
        { success: false, error: 'スケジュール投稿は50件まで登録できます' },
        400
      );
    }

const now = new Date().toISOString();
//0612修正終了
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
      next_run_at,
      last_posted_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      //20260614修正開始
      calculateNextWeeklyRunAt({
        weekday: item.weekday,
        time: item.time,
        offset: item.offset,
        timezone: item.timezone,
      }),
      item.lastPostedAt ?? null,
      //20260614修正終了
      now,
      now
    ).run();
  }

    return c.json({ success: true });
});

//202606新規終了