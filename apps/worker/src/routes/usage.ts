import { Hono } from 'hono';
import { getMonthSpend, getSpendBreakdown, UNIT_PRICES, getUsageSummary, getDailyUsage, getUsageByGate } from '@x-harness/db';
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
    const data = await getUsageByGate(c.env.DB);
    // Serialize snake_case to camelCase for frontend
    const serialized = data.map((g) => ({
      id: g.id,
      postId: g.post_id,
      triggerType: g.trigger_type,
      apiCallsTotal: g.api_calls_total,
      estimatedCost: g.estimatedCost,
      estimatedCostAvailable: false,
    }));
    return c.json({ success: true, data: serialized });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch usage by gate' }, 500);
  }
});

usage.get('/api/usage/spend',async c=>{
  const spent=await getMonthSpend(c.env.DB);
  const rows=(await c.env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('x_monthly_budget_usd','x_unit_prices')").all<{key:string;value:string}>()).results;
  const config=Object.fromEntries(rows.map(r=>[r.key,r.value]));
  let unitPrices={...UNIT_PRICES};if(config.x_unit_prices){try{const custom=JSON.parse(config.x_unit_prices);for(const [k,v] of Object.entries(custom))if(k in unitPrices&&typeof v==='number'&&Number.isFinite(v)&&v>=0)unitPrices[k]=v;}catch{}}
  const budget=Number(config.x_monthly_budget_usd ?? 50);const now=new Date();const days=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate();
  return c.json({success:true,data:{spent,budget,projected:spent/now.getUTCDate()*days,breakdown:await getSpendBreakdown(c.env.DB),unitPrices,estimate:true}});
});
export { usage };
