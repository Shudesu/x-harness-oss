import { jstNow } from './utils.js';

export interface DbApiUsageLog {
  id: string;
  x_account_id: string;
  endpoint: string;
  request_count: number;
  date: string;
  created_at: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  byEndpoint: Array<{ endpoint: string; count: number }>;
}

export interface DailyUsage {
  date: string;
  totalRequests: number;
  totalCost: number;
}

export interface GateUsage {
  id: string;
  x_account_id: string;
  post_id: string;
  trigger_type: string;
  api_calls_total: number;
  estimatedCost: number;
}

// X API Pay-Per-Use pricing (as of Feb 2026)
// https://docs.x.com/x-api/getting-started/pricing
const COST_BY_ENDPOINT: Record<string, number> = {
  // Read operations — $0.005 per request
  engagement_gate_poll: 0.005,
  get_user_tweets: 0.005,
  search_mentions: 0.005,
  search_own_replies: 0.005,
  get_quote_tweets: 0.005,
  sync_quotes: 0.005,
  dm_events: 0.005,
  // Write operations — $0.010 per request
  create_tweet: 0.010,
  delete_tweet: 0.010,
  like_tweet: 0.010,
  retweet: 0.010,
  upload_media: 0.010,
  dm_send: 0.010,
};
const DEFAULT_COST = 0.005;

// ======================================
// 202606 API使用量記録機能修正開始
// ======================================
function costForEndpoint(endpoint: string): number {
  const normalizedEndpoint = endpoint.startsWith('engagement_gate_poll:')
    ? 'engagement_gate_poll'
    : endpoint;

  return COST_BY_ENDPOINT[normalizedEndpoint] ?? DEFAULT_COST;
}

// function costForEndpoint(endpoint: string): number {
//   return COST_BY_ENDPOINT[endpoint] ?? DEFAULT_COST;
// }
// ======================================
// 202606 API使用量記録機能修正終了
// ======================================

// ======================================
// 202606 API使用量記録機能追加開始
// API使用量加算用オプション
// ======================================
export interface ApiUsageIncrementOptions {
  source?: string;      // 呼び出し元の目印
  method?: string;      // GET / POST など
  count?: number;       // 加算するAPI呼び出し回数
  windowStart?: string; // 集計基準日時
}
// ======================================
// 202606 API使用量記録機能追加終了
// ======================================

// ======================================
// 202606 API使用量記録機能修正開始
// api_usage_logs へUPSERT保存する
// 本番D1カラム:
// id, x_account_id, endpoint, request_count, date, created_at
// ======================================
export async function incrementApiUsage(
  db: D1Database,
  xAccountId: string,
  endpoint: string,
  options: string | ApiUsageIncrementOptions = {},
): Promise<void> {
  const normalizedOptions =
    typeof options === 'string' ? { source: options } : options;

  const count = normalizedOptions.count ?? 1;
  const windowStart = normalizedOptions.windowStart ?? jstNow();
  const date = windowStart.slice(0, 10);
  const now = jstNow();
  const id = crypto.randomUUID();

  // 不正な値でDBに記録しないためのチェック
  if (!xAccountId || !endpoint) {
    throw new Error('incrementApiUsage: xAccountId or endpoint missing');
  }

  await db
    .prepare(`
      INSERT INTO api_usage_logs (
        id,
        x_account_id,
        endpoint,
        request_count,
        date,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (x_account_id, endpoint, date)
      DO UPDATE SET
        request_count = api_usage_logs.request_count + excluded.request_count
    `)
    .bind(id, xAccountId, endpoint, count, date, now)
    .run();
}

// export async function incrementApiUsage(db: D1Database, xAccountId: string, endpoint: string): Promise<void> {
//   const id = crypto.randomUUID();
//   const date = jstNow().slice(0, 10);
//   const now = jstNow();
//   await db
//     .prepare(`
//       INSERT INTO api_usage_logs (id, x_account_id, endpoint, request_count, date, created_at)
//       VALUES (?, ?, ?, 1, ?, ?)
//       ON CONFLICT (x_account_id, endpoint, date)
//       DO UPDATE SET request_count = request_count + 1
//     `)
//     .bind(id, xAccountId, endpoint, date, now)
//     .run();
// }
// ======================================
// 202606 API使用量記録機能修正終了
// ======================================

// ======================================
// 202606 API使用量記録機能追加開始
// 使用量記録に失敗しても、画面/API本体は止めない
// ======================================
export async function recordApiUsageNonFatal(
  db: D1Database,
  xAccountId: string,
  endpoint: string,
  method = 'UNKNOWN',
  source = 'unknown',
  count = 1,
): Promise<void> {
  try {
    await incrementApiUsage(db, xAccountId, endpoint, {
      method,
      source,
      count,
    });
  } catch (error) {
    console.error('[api-usage] failed', {
      xAccountId,
      endpoint,
      method,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
// ======================================
// 202606 API使用量記録機能追加終了
// ======================================

export async function getUsageSummary(
  db: D1Database,
  xAccountId?: string,
  startDate?: string,
  endDate?: string,
): Promise<UsageSummary> {
  const conditions: string[] = [];
  const bindings: (string | null)[] = [];

  if (xAccountId) {
    conditions.push('x_account_id = ?');
    bindings.push(xAccountId);
  }
  if (startDate) {
    conditions.push('date >= ?');
    bindings.push(startDate);
  }
  if (endDate) {
    conditions.push('date <= ?');
    bindings.push(endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

// ======================================
// 202606 API使用量集計修正開始
// engagement_gate_poll:ゲートID を
// サマリ上は engagement_gate_poll としてまとめる
// ======================================
const rows = await db
  .prepare(`
    SELECT
      CASE
        WHEN endpoint LIKE 'engagement_gate_poll:%'
          THEN 'engagement_gate_poll'
        ELSE endpoint
      END AS endpoint,
      SUM(request_count) AS total
    FROM api_usage_logs
    ${where}
    GROUP BY
      CASE
        WHEN endpoint LIKE 'engagement_gate_poll:%'
          THEN 'engagement_gate_poll'
        ELSE endpoint
      END
  `)
  .bind(...bindings)
  .all<{ endpoint: string; total: number }>();

  // const rows = await db
  //   .prepare(`SELECT endpoint, SUM(request_count) as total FROM api_usage_logs ${where} GROUP BY endpoint`)
  //   .bind(...bindings)
  //   .all<{ endpoint: string; total: number }>();
// ======================================
// 202606 API使用量集計修正終了
// ======================================
  
  const byEndpoint: Array<{ endpoint: string; count: number }> = [];
  let totalRequests = 0;
  let totalCost = 0;
  for (const row of rows.results) {
    byEndpoint.push({ endpoint: row.endpoint, count: row.total });
    totalRequests += row.total;
    totalCost += row.total * costForEndpoint(row.endpoint);
  }

  return {
    totalRequests,
    totalCost,
    byEndpoint,
  };
}

export async function getDailyUsage(db: D1Database, xAccountId?: string, days = 30): Promise<DailyUsage[]> {

// ======================================
// 202606 API使用量日次集計修正開始
// days をSQL文字列に直接埋め込まず、安全なbind値にする
// ======================================
const safeDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 30;

const conditions: string[] = ["date >= date('now', ?)"];
const bindings: string[] = [`-${safeDays} days`];
  // const conditions: string[] = [`date >= date('now', '-${days} days')`];
  // const bindings: string[] = [];
// ======================================
// 202606 API使用量日次集計修正終了
// ======================================

  if (xAccountId) {
    conditions.push('x_account_id = ?');
    bindings.push(xAccountId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
// ======================================
// 202606 API使用量日次集計修正開始
// endpoint別に取得して、endpointごとの単価でコスト計算する
// ======================================
const rows = await db
  .prepare(`
    SELECT
      date,
      endpoint,
      SUM(request_count) AS total
    FROM api_usage_logs
    ${where}
    GROUP BY date, endpoint
    ORDER BY date ASC
  `)
  .bind(...bindings)
  .all<{ date: string; endpoint: string; total: number }>();
  // const rows = await db
  //   .prepare(`SELECT date, SUM(request_count) as total FROM api_usage_logs ${where} GROUP BY date ORDER BY date ASC`)
  //   .bind(...bindings)
  //   .all<{ date: string; total: number }>();
// ======================================
// 202606 API使用量日次集計修正終了
// ======================================
  
  // Daily breakdown doesn't have per-endpoint granularity, so use
  // a blended average. This is less accurate but sufficient for the chart.

// ======================================
// 202606 API使用量日次集計修正開始
// endpoint別の単価を使って、日付ごとに合算する
// ======================================
const daily = new Map<string, DailyUsage>();

for (const row of rows.results) {
  const current =
    daily.get(row.date) ??
    {
      date: row.date,
      totalRequests: 0,
      totalCost: 0,
    };

  const count = Number(row.total ?? 0);

  current.totalRequests += count;
  current.totalCost += count * costForEndpoint(row.endpoint);

  daily.set(row.date, current);
}

return [...daily.values()];
  // return rows.results.map((row) => ({
  //   date: row.date,
  //   totalRequests: row.total,
  //   totalCost: row.total * DEFAULT_COST,
  // }));
// ======================================
// 202606 API使用量日次集計修正終了
// ======================================
}

// ======================================
// 202606 API使用量ゲート別集計修正開始
// api_usage_logs の engagement_gate_poll:ゲートID を優先し、
// 既存の engagement_gates.api_calls_total は fallback として残す
// ======================================

export async function getUsageByGate(
  db: D1Database,
  xAccountId?: string,
): Promise<GateUsage[]> {
const where = xAccountId ? 'WHERE g.x_account_id = ?' : '';
const bindings = xAccountId ? [xAccountId] : [];

const rows = await db
  .prepare(`
    SELECT
      g.id,
      g.x_account_id,
      g.post_id,
      g.trigger_type,
      CASE
        WHEN COALESCE(SUM(u.request_count), 0) > 0
          THEN COALESCE(SUM(u.request_count), 0)
        ELSE COALESCE(g.api_calls_total, 0)
      END AS api_calls_total
    FROM engagement_gates g
    LEFT JOIN api_usage_logs u
      ON u.x_account_id = g.x_account_id
     AND u.endpoint = ('engagement_gate_poll:' || g.id)
    ${where}
    GROUP BY
      g.id,
      g.x_account_id,
      g.post_id,
      g.trigger_type,
      g.api_calls_total
    HAVING
      COALESCE(SUM(u.request_count), 0) > 0
      OR COALESCE(g.api_calls_total, 0) > 0
    ORDER BY api_calls_total DESC
  `)
  .bind(...bindings)
  .all<{
    id: string;
    x_account_id: string;
    post_id: string;
    trigger_type: string;
    api_calls_total: number;
  }>();

return rows.results.map((row) => ({
  id: row.id,
  x_account_id: row.x_account_id,
  post_id: row.post_id,
  trigger_type: row.trigger_type,
  api_calls_total: Number(row.api_calls_total ?? 0),
  estimatedCost:
    Number(row.api_calls_total ?? 0) * costForEndpoint('engagement_gate_poll'),
}));
// export async function getUsageByGate(db: D1Database): Promise<GateUsage[]> {
//   const rows = await db
//     .prepare('SELECT id, x_account_id, post_id, trigger_type, api_calls_total FROM engagement_gates WHERE api_calls_total > 0 ORDER BY api_calls_total DESC')
//     .all<{ id: string; x_account_id: string; post_id: string; trigger_type: string; api_calls_total: number }>();

//   return rows.results.map((row) => ({
//     id: row.id,
//     x_account_id: row.x_account_id,
//     post_id: row.post_id,
//     trigger_type: row.trigger_type,
//     api_calls_total: row.api_calls_total,
//     estimatedCost: row.api_calls_total * costForEndpoint(row.trigger_type === 'follow' ? 'engagement_gate_poll' : 'engagement_gate_poll'),
  //   }));
// ======================================
// 202606 API使用量ゲート別集計修正終了
// ======================================
}
