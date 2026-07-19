//202606新規追加
import { Hono } from 'hono';
import { jstNow } from '@x-harness/db';
import type { Env } from '../index.js';

//20260614新規追加開始
import { calculateNextWeeklyRunAt } from '../services/week-schedule-time.js';
//20260614新規追加終了
export const weeks = new Hono<Env>();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

type BulkItemInput = {
  id: unknown;
  weekday: unknown;
  time: unknown;
  offset: unknown;
  timezone: unknown;
  text: unknown;
  sortOrder: unknown;
  enabled: unknown;
};

type ValidatedItem = {
  id: string;
  weekday: number;
  time: string;
  offset: number;
  timezone: string;
  text: string;
  sortOrder: number;
  enabled: boolean;
};

// items を検証して正規化する。不正な項目があれば error を返し、DB には一切触れない。
function validateBulkItems(items: BulkItemInput[]): { items?: ValidatedItem[]; error?: string } {
  const validated: ValidatedItem[] = [];
  const seenIds = new Set<string>();

  for (const [index, item] of items.entries()) {
    const label = `items[${index}]`;
    if (typeof item !== 'object' || item === null) {
      return { error: `${label}: 不正な項目です` };
    }
    if (typeof item.id !== 'string' || item.id === '') {
      return { error: `${label}: id が必要です` };
    }
    if (seenIds.has(item.id)) {
      return { error: `${label}: id が重複しています` };
    }
    seenIds.add(item.id);

    const weekday = Number(item.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { error: `${label}: weekday は 0〜6 で指定してください` };
    }
    if (typeof item.time !== 'string' || !TIME_RE.test(item.time)) {
      return { error: `${label}: time は HH:MM 形式で指定してください` };
    }
    if (typeof item.text !== 'string' || item.text.trim() === '') {
      return { error: `${label}: text が必要です` };
    }
    if (item.text.length > 280) {
      return { error: `${label}: text は280文字以内で指定してください` };
    }
    const offset = Number(item.offset ?? 0);
    if (!Number.isFinite(offset) || offset < 0 || offset > 720) {
      return { error: `${label}: offset は 0〜720 分で指定してください` };
    }
    const timezone =
      typeof item.timezone === 'string' && item.timezone !== '' ? item.timezone : 'Asia/Tokyo';
    if (!isValidTimeZone(timezone)) {
      return { error: `${label}: timezone が不正です` };
    }

    validated.push({
      id: item.id,
      weekday,
      time: item.time,
      offset,
      timezone,
      text: item.text,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
      enabled: !!item.enabled,
    });
  }

  return { items: validated };
}
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

    const validation = validateBulkItems(items);
    if (validation.error || !validation.items) {
      return c.json({ success: false, error: validation.error ?? 'Invalid items' }, 400);
    }

const now = jstNow();
//0612修正終了

  // 既存行を読み、スケジュール定義が変わっていない行は next_run_at を維持する
  // (保存のたびにジッターが引き直されるのを防ぐ)。last_posted_at と created_at
  // はサーバ管理値なのでクライアント入力ではなく既存行から引き継ぐ。
  const existing = await c.env.DB.prepare(`
    SELECT id, weekday, time, offset, timezone, next_run_at, last_posted_at, created_at
    FROM scheduled_weeks
    WHERE x_account_id = ?
  `).bind(xAccountId).all<{
    id: string;
    weekday: number;
    time: string;
    offset: number;
    timezone: string;
    next_run_at: string | null;
    last_posted_at: string | null;
    created_at: string;
  }>();
  const existingById = new Map(existing.results.map((row) => [row.id, row]));

  const insertStmt = c.env.DB.prepare(`
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

  const statements = [
    c.env.DB.prepare(`DELETE FROM scheduled_weeks WHERE x_account_id = ?`).bind(xAccountId),
  ];

  for (const item of validation.items) {
    const prev = existingById.get(item.id);
    const scheduleUnchanged =
      prev &&
      Number(prev.weekday) === item.weekday &&
      prev.time === item.time &&
      Number(prev.offset) === item.offset &&
      prev.timezone === item.timezone;

    const nextRunAt =
      scheduleUnchanged && prev.next_run_at
        ? prev.next_run_at
        : calculateNextWeeklyRunAt({
            weekday: item.weekday,
            time: item.time,
            offset: item.offset,
            timezone: item.timezone,
          });

    statements.push(
      insertStmt.bind(
        item.id,
        xAccountId,
        item.weekday,
        item.time,
        item.offset,
        item.timezone,
        item.text,
        item.sortOrder,
        item.enabled ? 1 : 0,
        nextRunAt,
        prev?.last_posted_at ?? null,
        prev?.created_at ?? now,
        now
      )
    );
  }

  // DELETE と INSERT をひとつのバッチ(暗黙のトランザクション)で実行し、
  // 途中失敗時に削除だけが残ることを防ぐ。
  await c.env.DB.batch(statements);

    return c.json({ success: true });
});

//202606新規終了