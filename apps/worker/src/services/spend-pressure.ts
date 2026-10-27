import { getMonthSpend } from '@x-harness/db';
import { gateSpend } from './claim-verify.js';
export function pressureFactor(ratio: number) {
  return ratio >= 0.9 ? 4 : ratio >= 0.7 ? 2 : 1;
}
export function budgetRatio(spent: number, budget: number) {
  return budget > 0 ? spent / budget : 1;
}
export async function spendPressure(db: D1Database, gateId: string) {
  const setting = await db
    .prepare("SELECT value FROM settings WHERE key='x_monthly_budget_usd'")
    .first<{ value: string }>();
  const gate = await db
    .prepare('SELECT budget_usd FROM engagement_gates WHERE id=?')
    .bind(gateId)
    .first<{ budget_usd: number }>();
  const month = budgetRatio(await getMonthSpend(db), Number(setting?.value ?? 50));
  const ratio = budgetRatio(await gateSpend(db, gateId), gate?.budget_usd ?? 0);
  const maximum = Math.max(month, ratio);
  return { month, gate: ratio, factor: pressureFactor(maximum), overlapAllowed: maximum < 0.9 };
}
