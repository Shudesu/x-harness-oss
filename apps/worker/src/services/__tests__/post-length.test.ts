import { describe, it, expect, vi } from 'vitest';
import { charLimitForPlan, checkTextLength, getAccountPlan, weightedLength } from '../post-length.js';

// Minimal D1 stand-in for the settings table (the only table this module uses).
function settingsDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (!sql.startsWith('SELECT')) throw new Error(`unexpected ${sql}`);
              const v = rows.get(String(args[0]));
              return (v === undefined ? null : { value: v }) as T;
            },
            async run() {
              if (!sql.startsWith('INSERT INTO settings')) throw new Error(`unexpected ${sql}`);
              rows.set(String(args[0]), String(args[1]));
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, rows };
}

const plan = (subscription_type?: string) => ({ getMeWithSubscription: vi.fn(async () => ({ subscription_type })) });

describe('weightedLength', () => {
  it('counts like X (CJK/emoji = 2, URL = 23)', () => {
    expect(weightedLength('hello')).toBe(5);
    expect(weightedLength('こんにちは')).toBe(10);
    expect(weightedLength('見て https://example.com/a/very/long/path?x=1')).toBe(4 + 1 + 23);
    expect(weightedLength('👍')).toBe(2);
    expect(weightedLength('👨‍👩‍👧')).toBe(2);
    expect(weightedLength('ａ')).toBe(2);
    expect(weightedLength('a'.repeat(250) + ' example.com/' + 'b'.repeat(40))).toBe(250 + 1 + 23);
    expect(weightedLength('あ'.repeat(140))).toBe(280);
    expect(weightedLength('あ'.repeat(141))).toBe(282);
  });

  it('matches X on URL and symbol edge cases (twitter-text)', () => {
    expect(weightedLength('a'.repeat(279) + '©')).toBe(280); // text symbol, not emoji
    expect(weightedLength('a'.repeat(260) + ' a.co')).toBe(284); // bare domain = URL
    expect(weightedLength('a'.repeat(260) + ' http://a')).toBe(269); // not a URL
  });
});

describe('charLimitForPlan', () => {
  it('gives every paid tier 25,000 and everyone else 280', () => {
    expect(charLimitForPlan('Basic')).toBe(25000);
    expect(charLimitForPlan('Premium')).toBe(25000);
    expect(charLimitForPlan('PremiumPlus')).toBe(25000);
    expect(charLimitForPlan('None')).toBe(280);
    expect(charLimitForPlan(undefined)).toBe(280);
    expect(charLimitForPlan('Unknown')).toBe(280);
  });
});

describe('checkTextLength', () => {
  it('does not look up the plan for ≤280 posts', async () => {
    const { db } = settingsDb();
    const src = plan('None');
    expect((await checkTextLength(db, src, 'acc1', 'あ'.repeat(140))).ok).toBe(true);
    expect(src.getMeWithSubscription).not.toHaveBeenCalled();
  });

  it('rejects >280 for a non-Premium account with a clear Japanese error', async () => {
    const { db } = settingsDb();
    const r = await checkTextLength(db, plan('None'), 'acc1', 'あ'.repeat(141));
    expect(r).toMatchObject({ ok: false, weightedLength: 282, limit: 280, plan: 'None' });
    expect(r.error).toContain('280字');
  });

  it('allows long text up to 25,000 for every paid tier and rejects beyond it', async () => {
    for (const [i, tier] of ['Basic', 'Premium', 'PremiumPlus'].entries()) {
      const { db } = settingsDb();
      expect((await checkTextLength(db, plan(tier), `a${i}`, 'あ'.repeat(12500))).ok).toBe(true);
      const over = await checkTextLength(db, plan(tier), `a${i}`, 'a'.repeat(25001));
      expect(over).toMatchObject({ ok: false, limit: 25000, plan: tier });
      expect(over.error).toContain(tier);
    }
  });

  it('caches the plan (one X lookup per day) and re-derives limits from old cache entries', async () => {
    const { db } = settingsDb({
      'x_plan:old': JSON.stringify({ subscriptionType: 'Premium', charLimit: 10000, checkedAt: new Date().toISOString() }),
    });
    const src = plan('PremiumPlus');
    await getAccountPlan(db, src, 'acc1');
    expect((await getAccountPlan(db, src, 'acc1'))?.charLimit).toBe(25000);
    expect(src.getMeWithSubscription).toHaveBeenCalledTimes(1);
    const old = plan('Premium');
    expect((await checkTextLength(db, old, 'old', 'a'.repeat(12000))).ok).toBe(true);
    expect(old.getMeWithSubscription).not.toHaveBeenCalled();
  });

  it('treats a missing subscription_type as unknown (warning, not cached as None)', async () => {
    const { db, rows } = settingsDb();
    const r = await checkTextLength(db, plan(undefined), 'acc1', 'あ'.repeat(200));
    expect(r.ok).toBe(true);
    expect(r.warning).toContain('プランを確認できません');
    expect(rows.size).toBe(0);
  });

  it('does not reject on an expired restrictive plan when the refresh fails', async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const { db } = settingsDb({ 'x_plan:acc1': JSON.stringify({ subscriptionType: 'None', charLimit: 280, checkedAt: old }) });
    const r = await checkTextLength(db, { getMeWithSubscription: async () => { throw new Error('down'); } }, 'acc1', 'あ'.repeat(200));
    expect(r.ok).toBe(true);
    expect(r.warning).toBeTruthy();
  });

  it('keeps using an expired Premium plan when the refresh fails', async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const { db } = settingsDb({ 'x_plan:acc1': JSON.stringify({ subscriptionType: 'Premium', charLimit: 25000, checkedAt: old }) });
    const r = await checkTextLength(db, { getMeWithSubscription: async () => { throw new Error('down'); } }, 'acc1', 'あ'.repeat(200));
    expect(r).toMatchObject({ ok: true, plan: 'Premium', limit: 25000 });
  });

  it('allows with a warning when the plan cannot be determined', async () => {
    const { db } = settingsDb();
    const r = await checkTextLength(db, { getMeWithSubscription: async () => { throw new Error('down'); } }, 'acc1', 'あ'.repeat(200));
    expect(r.ok).toBe(true);
    expect(r.warning).toContain('プランを確認できません');
  });
});

describe('checkTextLength with a client factory', () => {
  it('builds the client only for text over 280', async () => {
    const { db } = settingsDb();
    const factory = vi.fn(async () => plan('Premium'));
    expect((await checkTextLength(db, factory, 'acc1', 'short')).ok).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    const r = await checkTextLength(db, factory, 'acc1', 'あ'.repeat(500));
    expect(r).toMatchObject({ ok: true, limit: 25000, plan: 'Premium' });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
