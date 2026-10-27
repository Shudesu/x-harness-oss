import { GrokClient } from '../../apps/worker/src/services/grok.js';
import { generateDigest } from '../../apps/worker/src/services/campaign-digest.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixture, now } from '../helpers/campaign.js';
import { getPublicCampaignStatus } from '../../apps/worker/src/services/campaign-status.js';
import {
  campaignDisplay,
  validMessageTemplates,
} from '../../apps/worker/src/services/campaign-display.js';
import { buildCampaignSummary } from '../../apps/worker/src/services/campaign-summary.js';
import {
  enqueueEndedDigests,
  enqueueWeeklyDigest,
  enqueueBudgetAlert,
  sendDigests,
  validateDigestLines,
} from '../../apps/worker/src/services/campaign-digest.js';
import { validateDigestSettings } from '../../apps/worker/src/services/digest-settings.js';
import { spendPressure } from '../../apps/worker/src/services/spend-pressure.js';
import { pollInterval } from '../../apps/worker/src/services/claim-poller.js';
import { estimateCampaign } from '../../apps/worker/src/services/campaign-estimate.js';
import { issueClaim } from '../../apps/worker/src/services/claim-codes.js';
import { finalizeParticipant, withGateLock } from '../../apps/worker/src/services/gate-rewards.js';
import {
  optInFollowup,
  earlyNoticeAudience,
} from '../../apps/worker/src/services/campaign-followup.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const settings = (sql: any, entries: Record<string, string>) => {
  for (const [k, v] of Object.entries(entries))
    sql
      .prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES (?,?,'2026-10-27')")
      .run(k, v);
};
describe('campaign visibility and result copy', () => {
  it('uses D1 only, masks small cohorts, rounds large cohorts and excludes consolation inventory', async () => {
    const f = fixture(),
      fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    f.sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',0,'Gift','url','https://example.test',3);INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota,is_consolation) VALUES ('c','g',1,'Consolation','line_message','Thanks',NULL,1)",
    );
    for (let i = 0; i < 9; i++) await issueClaim(f.db, f.gate, `friend-${i}`, now);
    expect(await getPublicCampaignStatus(f.db, f.gate)).toMatchObject({
      remaining: 3,
      unlimited: false,
      participants: null,
    });
    for (let i = 9; i < 129; i++) await issueClaim(f.db, f.gate, `friend-${i}`, now);
    expect((await getPublicCampaignStatus(f.db, f.gate)).participants).toBe(120);
    const summary = await buildCampaignSummary(f.db, 'g');
    expect(summary?.participants).toBe(129);
    f.sqlite.exec("UPDATE gate_rewards SET quota=NULL WHERE id='r'");
    expect((await getPublicCampaignStatus(f.db, f.gate)).remaining).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stores the total remaining inventory at settlement and uses accurate lottery copy', async () => {
    const f = fixture();
    f.gate.tier = 'simple';
    f.sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('r','g',0,'Gift','line_message','Thanks',3)",
    );
    for (let i = 1; i <= 4; i++) {
      const p = await issueClaim(f.db, f.gate, `f-${i}`, now);
      await withGateLock(f.db, 'g', (o) =>
        finalizeParticipant(f.db, f.gate, p.participant, o, now),
      );
    }
    const payloads = f.sqlite
      .prepare(
        "SELECT payload FROM event_outbox WHERE event='x.gate.reward_unlocked' ORDER BY rowid",
      )
      .all()
      .map((r: any) => JSON.parse(r.payload));
    expect(payloads[0].display.message).toBe('先着 #1 で当選！ 残り 2 名');
    expect(payloads[2].display.message).toContain('残り 0 名');
    expect(payloads[3].tags).toContain('gate_lost:g');
    expect(payloads[0].tags).not.toContain('gate_lost:g');
    expect(
      campaignDisplay({
        title: 'x',
        awardMode: 'lottery',
        outcome: 'won',
        rank: 2,
        remaining: 0,
        reward: 'Prize',
      }).message,
    ).not.toMatch(/先着|番目の参加/);
    expect(validMessageTemplates({ won: '{xUsername}' })).toBe(false);
  });
});
describe('operator digest', () => {
  it('waits for metrics, falls back after 30 minutes, deduplicates cron and sends template lines without X', async () => {
    const f = fixture();
    settings(f.sqlite, {
      digest_channels: '["slack"]',
      digest_slack_webhook: 'https://hooks.slack.com/services/synthetic/test/only',
    });
    const fetcher = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetcher);
    f.sqlite
      .prepare('UPDATE engagement_gates SET ends_at=?')
      .run(new Date(now - 29 * 60000).toISOString());
    await enqueueEndedDigests({ DB: f.db } as any, now);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM campaign_digests').get()?.n).toBe(0);
    await enqueueEndedDigests({ DB: f.db } as any, now + 60001);
    await enqueueEndedDigests({ DB: f.db } as any, now + 60002);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM campaign_digests').get()?.n).toBe(1);
    const row = f.sqlite.prepare('SELECT * FROM campaign_digests').get() as any;
    expect(JSON.parse(row.lines)).toHaveLength(3);
    expect(row.generated).toBe(0);
    await sendDigests({ DB: f.db } as any, now + 60003);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('hooks.slack.com');
  });
  it('rejects invented numbers and invalid Slack URLs, retries once after a minute, respects disabled channels', async () => {
    expect(
      validateDigestLines(
        { lines: ['参加2人', '問題0件', '次回を準備'] },
        { participants: 1, errors: 0 },
      ),
    ).toBe(false);
    expect(
      validateDigestSettings({
        digest_slack_webhook: 'https://hooks.slack.com.evil.test/services/x',
      }),
    ).toBe(false);
    expect(
      validateDigestSettings({
        digest_slack_webhook: 'https://hooks.slack.com@evil.test/services/x',
      }),
    ).toBe(false);
    const f = fixture();
    settings(f.sqlite, {
      digest_channels: '["slack"]',
      digest_slack_webhook: 'https://hooks.slack.com/services/synthetic/test/only',
    });
    f.sqlite
      .prepare('UPDATE engagement_gates SET ends_at=?')
      .run(new Date(now - 3600000).toISOString());
    await enqueueEndedDigests({ DB: f.db } as any);
    const fetcher = vi.fn(async () => {
      throw new Error('sensitive URL must not be persisted');
    });
    vi.stubGlobal('fetch', fetcher);
    await sendDigests({ DB: f.db } as any);
    expect(
      f.sqlite.prepare('SELECT next_at,last_error,status FROM campaign_digests').get(),
    ).toMatchObject({ next_at: now + 60000, last_error: 'delivery_failed', status: 'pending' });
    settings(f.sqlite, { digest_channels: '[]' });
    await sendDigests({ DB: f.db } as any, now + 60001);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('deduplicates weekly and NULL-gate monthly budget alerts', async () => {
    const f = fixture();
    settings(f.sqlite, { digest_channels: '["slack"]', digest_weekly_enabled: 'true' });
    const monday = Date.parse('2026-11-02T00:15:00Z');
    await enqueueWeeklyDigest({ DB: f.db } as any, monday);
    await enqueueWeeklyDigest({ DB: f.db } as any, monday);
    await enqueueBudgetAlert({ DB: f.db } as any, 70);
    await enqueueBudgetAlert({ DB: f.db } as any, 70);
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM campaign_digests WHERE kind='weekly'").get()?.n,
    ).toBe(1);
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM campaign_digests WHERE kind='budget'").get()?.n,
    ).toBe(1);
  });
});
describe('spend controls', () => {
  it('slows at 70/90 percent and stops new overlaps at 90 percent', async () => {
    const f = fixture();
    settings(f.sqlite, { x_monthly_budget_usd: '50' });
    f.sqlite.exec(
      "INSERT INTO api_spend_ledger(id,date_utc,x_account_id,feature,endpoint,resource_type,units,unit_cost_usd,cost_usd,source,created_at) VALUES ('spend','2026-10-27','a','other','/synthetic','post_read',1,36,36,'x','2026-10-27')",
    );
    expect(await spendPressure(f.db, 'g')).toMatchObject({ factor: 2, overlapAllowed: true });
    expect([
      pollInterval(now, now, 2),
      pollInterval(now - 200000, now, 2),
      pollInterval(now - 2000000, now, 2),
    ]).toEqual([30000, 120000, 600000]);
    f.sqlite.exec('UPDATE api_spend_ledger SET cost_usd=46');
    expect(await spendPressure(f.db, 'g')).toMatchObject({ factor: 4, overlapAllowed: false });
    expect([
      pollInterval(now, now, 4),
      pollInterval(now - 200000, now, 4),
      pollInterval(now - 2000000, now, 4),
    ]).toEqual([60000, 240000, 1200000]);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const a = await estimateCampaign(f.db, { tier: 'standard' }),
      b = await estimateCampaign(f.db, { tier: 'strict' });
    expect(b.high).toBeGreaterThan(a.high);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('consent and follow-up inventory', () => {
  it('keeps separate stock until opt-in and allocates once without X or push', async () => {
    const f = fixture();
    f.gate.tier = 'simple';
    f.gate.loser_followup = JSON.stringify({
      enabled: true,
      offer: 'both',
      couponRewardId: 'coupon',
    });
    f.sqlite
      .prepare('UPDATE engagement_gates SET loser_followup=?,line_connection_id=? WHERE id=?')
      .run(f.gate.loser_followup, 'conn', 'g');
    f.sqlite.exec(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota,is_consolation) VALUES ('coupon','g',1,'Coupon','coupon_code','',1,1);INSERT INTO reward_codes(id,reward_id,code) VALUES ('code','coupon','SYNTHETIC')",
    );
    const a = await issueClaim(f.db, f.gate, 'friend', now);
    await withGateLock(f.db, 'g', (o) => finalizeParticipant(f.db, f.gate, a.participant, o, now));
    expect(
      f.sqlite.prepare("SELECT issued FROM gate_rewards WHERE id='coupon'").get()?.issued,
    ).toBe(0);
    const participant = f.sqlite.prepare('SELECT * FROM gate_participants').get() as any;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const first = await optInFollowup(f.db, f.gate, participant),
      second = await optInFollowup(f.db, f.gate, participant);
    expect(first).toEqual(second);
    expect(first.coupon?.value).toBe('SYNTHETIC');
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM gate_events WHERE type='followup_opt_in'").get()?.n,
    ).toBe(1);
    expect(await earlyNoticeAudience(f.db, ['g'], 'a', 'conn')).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(optInFollowup(f.db, f.gate, { ...participant, outcome: 'won' })).rejects.toThrow(
      'followup_not_available',
    );
  });
});

it('falls back on invented AI counts without losing delivery and sends each leased digest once', async () => {
  const f = fixture(),
    fallback = ['結果1人', '問題0件', '次の企画を準備'];
  vi.spyOn(GrokClient.prototype, 'respond').mockResolvedValue({
    json: { lines: ['結果999人', '問題0件', '次の企画を準備'] },
  } as any);
  expect(
    await generateDigest(
      { DB: f.db, XAI_API_KEY: 'synthetic' } as any,
      'a',
      { participants: 1, errors: 0 },
      fallback,
    ),
  ).toEqual({ lines: fallback, generated: false });
  settings(f.sqlite, {
    digest_channels: '["slack"]',
    digest_slack_webhook: 'https://hooks.slack.com/services/synthetic/test/only',
  });
  f.sqlite
    .prepare('UPDATE engagement_gates SET ends_at=?')
    .run(new Date(now - 3600000).toISOString());
  await Promise.all([
    enqueueEndedDigests({ DB: f.db } as any),
    enqueueEndedDigests({ DB: f.db } as any),
  ]);
  const fetcher = vi.fn(async () => new Response('ok'));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([sendDigests({ DB: f.db } as any), sendDigests({ DB: f.db } as any)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects a notification redirect without forwarding credentials or marking delivery sent',async()=>{
 const f=fixture();settings(f.sqlite,{digest_channels:'["slack"]',digest_slack_webhook:'https://hooks.slack.com/services/synthetic/test/only'});
 f.sqlite.prepare('UPDATE engagement_gates SET ends_at=?').run(new Date(now-3600000).toISOString());await enqueueEndedDigests({DB:f.db} as any);
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status:302,headers:{Location:'https://untrusted.example'}}));vi.stubGlobal('fetch',fetcher);
 await sendDigests({DB:f.db} as any);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');expect(f.sqlite.prepare('SELECT status,last_error FROM campaign_digests').get()).toMatchObject({status:'pending',last_error:'slack_delivery_failed'});
});
