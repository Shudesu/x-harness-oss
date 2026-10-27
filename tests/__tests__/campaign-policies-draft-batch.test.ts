import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixture, now } from '../helpers/campaign.js';
import { issueClaim } from '../../apps/worker/src/services/claim-codes.js';
import { matchClaimPosts } from '../../apps/worker/src/services/reply-code-matcher.js';
import { pollClaimGate } from '../../apps/worker/src/services/claim-poller.js';
import {
  pollAccountGates,
  buildBatchQueries,
  routeBatchPosts,
} from '../../apps/worker/src/services/claim-batch-poller.js';
import {
  draftCampaign,
  weightedPostLength,
  validateDraftExtras,
} from '../../apps/worker/src/services/campaign-draft.js';
import { validateCampaignInput } from '../../apps/worker/src/services/campaign-validation.js';
import { GrokClient } from '../../apps/worker/src/services/grok.js';
const client = vi.hoisted(() => ({
  searchClaimReplies: vi.fn(),
  getRelationshipById: vi.fn(),
  getTweets: vi.fn(),
  getLikingUsers: vi.fn(),
}));
const build = vi.hoisted(() => vi.fn(async () => client));
vi.mock('../../apps/worker/src/services/x-client.js', () => ({ buildXClient: build }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function participants(f: ReturnType<typeof fixture>, n: number) {
  const people = [];
  for (let i = 1; i <= n; i++) {
    const p = await issueClaim(f.db, f.gate, `friend-${i}`, now);
    people.push(p);
    await matchClaimPosts(
      f.db,
      f.gate,
      [
        {
          id: String(1000 + i),
          text: `${f.gate.claim_phrase}-${p.claim!.code}`,
          author_id: String(i),
          created_at: new Date(now + 1000 * i).toISOString(),
          conversation_id: f.gate.post_id,
        },
      ],
      [
        {
          id: String(i),
          username: `user${i}`,
          created_at: '2020-01-01T00:00:00Z',
          public_metrics: { followers_count: 100 },
        },
      ],
      now + 20000,
    );
  }
  return people;
}
function strictFixture(quota: number | null = 3) {
  const f = fixture();
  f.sqlite
    .prepare(
      "UPDATE engagement_gates SET tier='strict',follow_policy='verify_winners',settle_sec=0",
    )
    .run();
  f.gate = f.sqlite.prepare("SELECT * FROM engagement_gates WHERE id='g'").get() as any;
  f.sqlite
    .prepare(
      "INSERT INTO gate_rewards(id,gate_id,tier,label,type,value_template,quota) VALUES ('reward','g',0,'Gift','line_message','Synthetic',?)",
    )
    .run(quota);
  client.searchClaimReplies.mockResolvedValue({ data: [], meta: {} });
  client.getRelationshipById.mockImplementation(async (id: string) => ({
    id,
    connection_status: ['followed_by'],
  }));
  client.getTweets.mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({ id, author_id: String(Number(id) - 1000) })),
  );
  return f;
}
describe('winner verification window', () => {
  it('checks only three candidates, then finalizes losers without any X calls', async () => {
    const f = strictFixture();
    await participants(f, 10);
    vi.setSystemTime(now + 30000);
    await pollClaimGate({ DB: f.db } as any, 'g');
    expect(client.getRelationshipById).toHaveBeenCalledTimes(3);
    expect(client.getTweets).toHaveBeenCalledTimes(3);
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM gate_participants WHERE outcome='lost'").get()?.n,
    ).toBe(7);
    vi.clearAllMocks();
    vi.setSystemTime(now + 50000);
    await pollClaimGate({ DB: f.db } as any, 'g');
    expect(build).not.toHaveBeenCalled();
  });
  it('promotes the fourth applicant after exhausted follow retries and preserves missing reasons', async () => {
    const f = strictFixture();
    const p = await participants(f, 5);
    f.sqlite
      .prepare(
        "UPDATE gate_participants SET status='missing_conditions',verify_attempts=3,missing='[\"follow\"]' WHERE id=?",
      )
      .run(p[1].participant.id);
    vi.setSystemTime(now + 30000);
    await pollClaimGate({ DB: f.db } as any, 'g');
    expect(client.getRelationshipById.mock.calls.map((x) => x[0])).toEqual(['1', '3', '4']);
    vi.clearAllMocks();
    vi.setSystemTime(now + 50000);
    await pollClaimGate({ DB: f.db } as any, 'g');
    expect(
      f.sqlite
        .prepare('SELECT outcome,missing FROM gate_participants WHERE id=?')
        .get(p[1].participant.id),
    ).toMatchObject({ outcome: 'lost', missing: '["follow"]' });
    expect(build).not.toHaveBeenCalled();
  });
  it('keeps unlimited rewards outside the window', async () => {
    const f = strictFixture(null);
    await participants(f, 5);
    vi.setSystemTime(now + 30000);
    await pollClaimGate({ DB: f.db } as any, 'g');
    expect(client.getRelationshipById).toHaveBeenCalledTimes(5);
  });
  it.each([100, 99])(
    'loads likes once; %i returned users cannot disqualify absent candidates when capped',
    async (n) => {
      const f = strictFixture();
      f.sqlite.exec("UPDATE engagement_gates SET like_policy='verify_winners'");
      await participants(f, 3);
      client.getLikingUsers.mockResolvedValue({
        data: Array.from({ length: n }, (_, i) => ({ id: String(2000 + i) })),
      });
      vi.setSystemTime(now + 30000);
      await pollClaimGate({ DB: f.db } as any, 'g');
      expect(client.getLikingUsers).toHaveBeenCalledTimes(1);
      expect(
        f.sqlite.prepare("SELECT COUNT(*) n FROM gate_participants WHERE outcome='won'").get()?.n,
      ).toBe(n === 100 ? 3 : 0);
      if (n === 100)
        expect(
          f.sqlite
            .prepare("SELECT COUNT(*) n FROM gate_events WHERE type='like_unverifiable'")
            .get()?.n,
        ).toBe(3);
    },
  );
});
it('enforces budget backoff for automatic polls and records one backoff event per level', async () => {
  const f = fixture();
  await issueClaim(f.db, f.gate, 'friend', now);
  f.sqlite.exec(
    "INSERT INTO api_spend_ledger(id,date_utc,x_account_id,feature,endpoint,resource_type,units,unit_cost_usd,cost_usd,source,created_at) VALUES ('spend','2026-10-27','a','other','/fixture','post_read',1,36,36,'x','2026-10-27')",
  );
  client.searchClaimReplies.mockResolvedValue({ data: [], meta: {} });
  vi.setSystemTime(now + 1000);
  await pollClaimGate({ DB: f.db } as any, 'g');
  vi.setSystemTime(now + 16000);
  const waiting = await pollClaimGate({ DB: f.db } as any, 'g');
  expect(waiting.retryAfterSec).toBe(15);
  expect(client.searchClaimReplies).toHaveBeenCalledTimes(1);
  vi.setSystemTime(now + 31000);
  await pollClaimGate({ DB: f.db } as any, 'g');
  expect(client.searchClaimReplies).toHaveBeenCalledTimes(2);
  expect(
    f.sqlite.prepare("SELECT COUNT(*) n FROM gate_events WHERE type='spend_backoff'").get()?.n,
  ).toBe(1);
});
describe('drafts and save validation', () => {
  it('returns an unsaved fallback with an editable phrase and never constructs an X client', async () => {
    const f = fixture(),
      before = f.sqlite.prepare('SELECT COUNT(*) n FROM engagement_gates').get()?.n;
    const r = await draftCampaign({ DB: f.db } as any, { xAccountId: 'a', brief: '春の先着特典' });
    expect(r.generated).toBe(false);
    expect(r.draft.claimPhrase).toBe('');
    expect(r.validation.ok).toBe(false);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM engagement_gates').get()?.n).toBe(before);
    expect(build).not.toHaveBeenCalled();
    expect(weightedPostLength('日本 https://example.com/long')).toBe(28);
    expect(weightedPostLength('👨‍👩‍👧‍👦')).toBe(2);
  });
  it('regenerates at most once and replaces only invalid AI fields', async () => {
    const f = fixture();
    const fallback = (
      await draftCampaign({ DB: f.db } as any, { xAccountId: 'a', brief: '春の先着特典' })
    ).draft;
    const generated = {
      ...fallback,
      title: '安全な企画',
      claimPhrase: 'SALE2',
      announcementText: 'フォロー必須 SALE2 {entryUrl}',
      endsAt: '2020-01-01T00:00:00+09:00',
    };
    const spy = vi
      .spyOn(GrokClient.prototype, 'respond')
      .mockResolvedValue({ json: generated } as any);
    const r = await draftCampaign({ DB: f.db, XAI_API_KEY: 'synthetic' } as any, {
      xAccountId: 'a',
      brief: '春の先着特典',
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.draft.title).toBe('安全な企画');
    expect(r.draft.claimPhrase).toBe('');
    expect(r.validation.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['claimPhrase', 'announcementText', 'endsAt']),
    );
    expect(spy.mock.calls.every(([args]) => args.tools === undefined)).toBe(true);
    expect(build).not.toHaveBeenCalled();
  });
  it('requires explicit opt-in for standard condition verification and rejects draft phrase collisions', async () => {
    const f = fixture();
    const d = (await draftCampaign({ DB: f.db } as any, { xAccountId: 'a', brief: '春の先着特典' }))
      .draft;
    expect(
      validateDraftExtras(
        { ...d, claimPhrase: '春プレ' },
        { now, tier: 'standard', activePhrases: ['春プレ'] },
      ).errors.some((e) => e.field === 'claimPhrase'),
    ).toBe(true);
    const input = {
      ...d,
      postId: '123',
      claimPhrase: '夏特典',
      tier: 'standard',
      followPolicy: 'verify_winners',
      rewards: [{ label: 'Gift', type: 'line_message', value: 'Thanks', quota: 3 }],
    };
    expect(validateCampaignInput(input).ok).toBe(false);
    expect(validateCampaignInput({ ...input, verifyConditionsOptIn: true }).ok).toBe(true);
  });
});
describe('account batch search', () => {
  it('performs one search for two campaigns and routes separate phrases without wrong-campaign rejections', async () => {
    const f = fixture();
    f.sqlite.exec(
      "INSERT INTO settings(key,value,updated_at) VALUES ('claim_batch_search','true','2026');INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at,gate_mode,slug,title,ends_at,claim_phrase,brand_username,gate_state) VALUES ('g2','a','888','reply','verify_only','','2026-10-26','2026-10-26','line_first','summer','Summer','2026-11-03T00:00:00Z','夏特典','brand','active')",
    );
    const g2 = f.sqlite.prepare("SELECT * FROM engagement_gates WHERE id='g2'").get() as any;
    const a = await issueClaim(f.db, f.gate, 'first', now),
      b = await issueClaim(f.db, g2, 'second', now);
    client.searchClaimReplies.mockResolvedValue({
      data: [
        {
          id: '1001',
          text: `春プレ-${a.claim!.code}`,
          author_id: '1',
          created_at: new Date(now + 1000).toISOString(),
          conversation_id: '999',
        },
        {
          id: '1002',
          text: `夏特典-${b.claim!.code} @brand`,
          author_id: '2',
          created_at: new Date(now + 1000).toISOString(),
        },
      ],
      includes: {
        users: [
          { id: '1', username: 'one', created_at: '2020-01-01T00:00:00Z' },
          { id: '2', username: 'two', created_at: '2020-01-01T00:00:00Z' },
        ],
      },
      meta: {},
    });
    vi.setSystemTime(now + 20000);
    await pollAccountGates({ DB: f.db } as any, 'a');
    expect(client.searchClaimReplies).toHaveBeenCalledTimes(1);
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM claim_codes WHERE status='provisional'").get()?.n,
    ).toBe(2);
    expect(
      f.sqlite.prepare("SELECT COUNT(*) n FROM gate_events WHERE type='wrong_campaign'").get()?.n,
    ).toBe(0);
    expect(buildBatchQueries([f.gate, g2], 120)).toHaveLength(2);
    expect(
      routeBatchPosts(
        [f.gate, g2],
        [{ id: '1', author_id: '2', created_at: '2026', text: `夏特典-${b.claim!.code} @brand` }],
      ).get('g')!,
    ).toHaveLength(0);
  });
  it('catches up a newly added gate before joining an existing shared since_id', async () => {
    const f = fixture();
    f.sqlite.exec(
      "INSERT INTO settings(key,value,updated_at) VALUES ('claim_batch_search','true','2026');INSERT INTO engagement_gates(id,x_account_id,post_id,trigger_type,action_type,template,created_at,updated_at,gate_mode,slug,title,ends_at,claim_phrase,brand_username,gate_state) VALUES ('g2','a','888','reply','verify_only','','2026-10-26','2026-10-26','line_first','summer','Summer','2026-11-03T00:00:00Z','夏特典','brand','active')",
    );
    f.sqlite
      .prepare(
        'INSERT INTO claim_search_cursors(x_account_id,since_id,gate_ids,gate_set_hash,updated_at) VALUES (?,?,?,?,0)',
      )
      .run('a', '5000', JSON.stringify(['g']), JSON.stringify(['g']));
    const g2 = f.sqlite.prepare("SELECT * FROM engagement_gates WHERE id='g2'").get() as any;
    await issueClaim(f.db, f.gate, 'first', now);
    const b = await issueClaim(f.db, g2, 'second', now);
    client.searchClaimReplies.mockImplementation(async (query: string) =>
      query.includes('conversation_id:888') && !query.includes('conversation_id:999')
        ? {
            data: [
              {
                id: '2000',
                text: `夏特典-${b.claim!.code}`,
                author_id: '2',
                conversation_id: '888',
                created_at: new Date(now + 1000).toISOString(),
              },
            ],
            includes: { users: [{ id: '2', username: 'two', created_at: '2020-01-01T00:00:00Z' }] },
            meta: {},
          }
        : { data: [], meta: {} },
    );
    vi.setSystemTime(now + 20000);
    await pollAccountGates({ DB: f.db } as any, 'a');
    expect(client.searchClaimReplies).toHaveBeenCalledTimes(2);
    expect(client.searchClaimReplies.mock.calls[0][1].sinceId).toBeUndefined();
    expect(
      f.sqlite.prepare('SELECT status,reply_tweet_id FROM claim_codes WHERE id=?').get(b.claim!.id),
    ).toMatchObject({ status: 'provisional', reply_tweet_id: '2000' });
  });
  it('does nothing while disabled', async () => {
    const f = fixture();
    await pollAccountGates({ DB: f.db } as any, 'a');
    expect(build).not.toHaveBeenCalled();
  });
});
