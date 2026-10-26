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

export async function incrementApiUsage(db: D1Database, xAccountId: string, endpoint: string): Promise<void> {
  return incrementApiUsageBy(db, xAccountId, endpoint, 1);
}

export async function incrementApiUsageBy(db: D1Database, xAccountId: string, endpoint: string, count: number): Promise<void> {
  if (count <= 0) return;
  const id = crypto.randomUUID();
  const date = jstNow().slice(0, 10);
  const now = jstNow();
  await db
    .prepare(`
      INSERT INTO api_usage_logs (id, x_account_id, endpoint, request_count, date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (x_account_id, endpoint, date)
      DO UPDATE SET request_count = request_count + excluded.request_count
    `)
    .bind(id, xAccountId, endpoint, count, date, now)
    .run();
}

// Total request count for one endpoint on a given JST date (across all accounts).
// Used to enforce daily caps on public endpoints.
export async function getEndpointUsageForDate(db: D1Database, endpoint: string, date?: string): Promise<number> {
  const d = date ?? jstNow().slice(0, 10);
  const row = await db
    .prepare('SELECT SUM(request_count) as total FROM api_usage_logs WHERE endpoint = ? AND date = ?')
    .bind(endpoint, d)
    .first<{ total: number | null }>();
  return row?.total ?? 0;
}

export async function getUsageSummary(
  db: D1Database,
  xAccountId?: string,
  startDate?: string,
  endDate?: string,
): Promise<UsageSummary> {
  // *_quota rows are internal rate-limit counters, not billable API calls
  const conditions: string[] = ["endpoint NOT LIKE '%\\_quota' ESCAPE '\\'"];
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
  const rows = await db
    .prepare(`SELECT endpoint, SUM(request_count) as total FROM api_usage_logs ${where} GROUP BY endpoint`)
    .bind(...bindings)
    .all<{ endpoint: string; total: number }>();

  const byEndpoint: Array<{ endpoint: string; count: number }> = [];
  let totalRequests = 0;
  let totalCost = 0;
  for (const row of rows.results) {
    byEndpoint.push({ endpoint: row.endpoint, count: row.total });
    totalRequests += row.total;

  }

  const spendConditions=['source = ?']; const spendBinds:unknown[]=['x'];
  if(xAccountId){spendConditions.push('x_account_id = ?');spendBinds.push(xAccountId);}
  if(startDate){spendConditions.push('date_utc >= ?');spendBinds.push(startDate);}
  if(endDate){spendConditions.push('date_utc <= ?');spendBinds.push(endDate);}
  const spend=await db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS total FROM api_spend_ledger WHERE ${spendConditions.join(' AND ')}`).bind(...spendBinds).first<{total:number}>();
  totalCost=spend?.total ?? 0;
  return {
    totalRequests,
    totalCost,
    byEndpoint,
  };
}

export async function getDailyUsage(db: D1Database, xAccountId?: string, days = 30): Promise<DailyUsage[]> {
  const conditions: string[] = [`date >= date('now', '-${days} days')`, "endpoint NOT LIKE '%\\_quota' ESCAPE '\\'"];
  const bindings: string[] = [];

  if (xAccountId) {
    conditions.push('x_account_id = ?');
    bindings.push(xAccountId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = await db
    .prepare(`SELECT date, SUM(request_count) as total FROM api_usage_logs ${where} GROUP BY date ORDER BY date ASC`)
    .bind(...bindings)
    .all<{ date: string; total: number }>();

  // Daily breakdown doesn't have per-endpoint granularity, so use
  // a blended average. This is less accurate but sufficient for the chart.
  return rows.results.map((row) => ({
    date: row.date,
    totalRequests: row.total,
    totalCost: 0, // No resource-level history exists in legacy counters.
  }));
}

export async function getUsageByGate(db: D1Database): Promise<GateUsage[]> {
  const rows = await db
    .prepare('SELECT id, x_account_id, post_id, trigger_type, api_calls_total FROM engagement_gates WHERE api_calls_total > 0 ORDER BY api_calls_total DESC')
    .all<{ id: string; x_account_id: string; post_id: string; trigger_type: string; api_calls_total: number }>();

  return rows.results.map((row) => ({
    id: row.id,
    x_account_id: row.x_account_id,
    post_id: row.post_id,
    trigger_type: row.trigger_type,
    api_calls_total: row.api_calls_total,
    estimatedCost: 0, // Legacy requests cannot establish billable units.
  }));
}
