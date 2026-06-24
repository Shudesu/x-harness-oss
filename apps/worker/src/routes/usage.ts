import { Hono } from 'hono';
import { getUsageSummary, getDailyUsage, getUsageByGate } from '@x-harness/db';
import type { Env } from '../index.js';

const usage = new Hono<Env>();

// GET /api/usage — usage summary (total requests + by endpoint)
usage.get('/api/usage', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  try {
    const data = await getUsageSummary(
      c.env.DB,
      xAccountId ?? undefined,
      startDate ?? undefined,
      endDate ?? undefined,
    );
    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch usage summary' }, 500);
  }
});

// GET /api/usage/daily — daily usage breakdown
usage.get('/api/usage/daily', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const daysParam = c.req.query('days');
  const days = daysParam ? Number(daysParam) : 30;
  try {
    const data = await getDailyUsage(c.env.DB, xAccountId ?? undefined, days);
    // Serialize to match frontend DailyUsage { date, count }
    const serialized = data.map((d) => ({ date: d.date, count: d.totalRequests }));
    return c.json({ success: true, data: serialized });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch daily usage' }, 500);
  }
});

// GET /api/usage/by-gate — API usage grouped by engagement gate
usage.get('/api/usage/by-gate', async (c) => {
  try {
    // ======================================
    // 202606 API使用量ゲート別集計修正開始
    // 指定されたXアカウントのみ取得
    // ======================================
    const xAccountId = c.req.query('xAccountId');

    const data = await getUsageByGate(
      c.env.DB,
      xAccountId ?? undefined,
    );
    //const data = await getUsageByGate(c.env.DB);
    // ======================================
    // 202606 API使用量ゲート別集計修正終了
    // ======================================
    
    // Serialize snake_case to camelCase for frontend
    const serialized = data.map((g) => ({
      id: g.id,
      postId: g.post_id,
      triggerType: g.trigger_type,
      apiCallsTotal: g.api_calls_total,
      estimatedCost: g.estimatedCost,
    }));
    return c.json({ success: true, data: serialized });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch usage by gate' }, 500);
  }
});

export { usage };
