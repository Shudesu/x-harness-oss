// Official pricing checked 2026-10-26. Estimates, not a billing receipt.
export const UNIT_PRICES: Record<string,number> = {post_read:.005,user_read:.010,follows_read:.010,likes_read:.001,dm_read:.010,post_create:.015,post_create_url:.20,dm_create:.015,interaction_create:.015,delete:.010,media:.005,owned_read:.001,counts:.005,trends:.010,news_read:.005,webhook_post:.005};
export async function recordSpend(db:D1Database, u:{accountId:string;feature:string;endpoint:string;resourceType:string;units:number;unitCost:number;source?:string}) {
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO api_spend_ledger (id,date_utc,x_account_id,feature,endpoint,resource_type,units,unit_cost_usd,cost_usd,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),now.slice(0,10),u.accountId,u.feature,u.endpoint,u.resourceType,u.units,u.unitCost,u.units*u.unitCost,u.source ?? 'x',now).run();
}
export async function getMonthSpend(db:D1Database,source='x'):Promise<number> {
  const row=await db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS total FROM api_spend_ledger WHERE source = ? AND date_utc >= ?').bind(source,new Date().toISOString().slice(0,7)+'-01').first<{total:number}>();
  return row?.total ?? 0;
}
export async function getSpendBreakdown(db:D1Database) {
  return (await db.prepare('SELECT source,feature,endpoint,resource_type,SUM(units) AS units,SUM(cost_usd) AS cost_usd FROM api_spend_ledger WHERE date_utc >= ? GROUP BY source,feature,endpoint,resource_type').bind(new Date().toISOString().slice(0,7)+'-01').all()).results;
}
