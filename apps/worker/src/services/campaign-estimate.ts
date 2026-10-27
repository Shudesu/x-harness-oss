import { UNIT_PRICES } from '@x-harness/db';
export const PRICE_NOTE =
  'X API 単価は 2026-10-26 時点の公開値の推定（※要確認）。請求額は X Developer Console で確認してください。';
export async function estimateCampaign(db: D1Database, query: Record<string, string>) {
  const tier = query.tier ?? 'standard',
    expectedReplies = Number(query.expectedReplies ?? 100),
    quota = query.quota === 'unlimited' ? null : Number(query.quota ?? 10),
    days = Number(query.days ?? 7);
  if (
    !['simple', 'standard', 'strict'].includes(tier) ||
    !Number.isSafeInteger(expectedReplies) ||
    expectedReplies < 0 ||
    expectedReplies > 1000000 ||
    (quota !== null && (!Number.isSafeInteger(quota) || quota < 0 || quota > 1000000)) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 60 ||
    (query.verifyFollow !== undefined && !['true', 'false'].includes(query.verifyFollow)) ||
    (query.awardMode !== undefined && !['first_come', 'lottery'].includes(query.awardMode))
  )
    throw new Error('Invalid estimate input');
  const prices = { ...UNIT_PRICES },
    setting = await db
      .prepare("SELECT value FROM settings WHERE key='x_unit_prices'")
      .first<{ value: string }>();
  if (setting)
    try {
      for (const [key, value] of Object.entries(JSON.parse(setting.value)))
        if (key in prices && typeof value === 'number' && Number.isFinite(value) && value >= 0)
          prices[key] = value;
    } catch {
      /* Ignore invalid old configuration. */
    }
  if (tier === 'simple')
    return {
      low: 0,
      high: 0,
      candidates: 0,
      days,
      priceNote: PRICE_NOTE,
      notes: ['かんたんはXを確認しません。'],
    };
  const verifies = tier === 'strict' || query.verifyFollow === 'true';
  const candidates = verifies
    ? quota === null || query.awardMode === 'lottery'
      ? expectedReplies
      : Math.min(expectedReplies, Math.ceil(quota * 1.2))
    : 0;
  const read = expectedReplies * (prices.post_read + prices.user_read);
  const checks = candidates * (prices.user_read + (tier === 'strict' ? prices.post_read : 0));
  const low = read + checks + prices.post_read,
    high = read * (tier === 'strict' ? 2 : 1.5) + checks * 1.2 + prices.post_read;
  return {
    low,
    high,
    candidates,
    days,
    priceNote: PRICE_NOTE,
    notes: [
      '展開ユーザーの課金・重複係数は未確認です。追加投稿や再試行で見込みを超える場合があります。',
    ],
  };
}
