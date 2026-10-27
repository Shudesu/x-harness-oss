import {
  enqueueEndedDigests,
  sendDigests,
} from '../../apps/worker/src/services/campaign-digest.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from '../../apps/worker/node_modules/hono/dist/index.js';
import { it, expect, vi, afterEach } from 'vitest';
import xWorker from '../../apps/worker/src/index.js';
import { sendLineOutbox } from '../../apps/worker/src/services/line-events.js';
const lineRoot = process.env.LINE_GATE_REPO!;
const sends: Request[] = [];
vi.doMock(lineRoot + '/apps/worker/src/services/local-line-proxy.ts', () => ({
  dispatchLineProxyLocally: async (request: Request) => {
    sends.push(request.clone());
    return Response.json({});
  },
}));
const { xGates } = await import(/* @vite-ignore */ lineRoot + '/apps/worker/src/routes/x-gates.ts');
function adapter(sql: DatabaseSync) {
  const statement = (query: string, binds: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(query, v),
    first: async () => sql.prepare(query).get(...(binds as any)) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...(binds as any)) }),
    run: async () => ({ meta: { changes: sql.prepare(query).run(...(binds as any)).changes } }),
    _run: () => ({ meta: { changes: sql.prepare(query).run(...(binds as any)).changes } }),
  });
  return {
    prepare: (q: string) => statement(q),
    batch: async (list: any[]) => {
      sql.exec('BEGIN');
      try {
        const result = list.map((s) => s._run());
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  } as any;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('runs both real route implementations from LINE identity to one reward and one proxied notification', async () => {
  const now = Date.parse('2026-10-27T10:00:00Z');
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const xs = new DatabaseSync(':memory:');
  for (const file of readdirSync('packages/db/bootstrap').sort())
    xs.exec(readFileSync(`packages/db/bootstrap/${file}`, 'utf8'));
  const ls = new DatabaseSync(':memory:');
  ls.exec(
    `CREATE TABLE line_accounts(id TEXT PRIMARY KEY,channel_id TEXT,channel_access_token TEXT,login_channel_id TEXT,liff_id TEXT,is_active INTEGER,created_at TEXT);CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT,color TEXT,created_at TEXT);CREATE TABLE tracked_links(id TEXT PRIMARY KEY,name TEXT,original_url TEXT,line_account_id TEXT,is_active INTEGER,click_count INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE friends(id TEXT PRIMARY KEY,line_user_id TEXT UNIQUE,line_account_id TEXT,display_name TEXT,is_following INTEGER,metadata TEXT DEFAULT '{}',created_at TEXT,updated_at TEXT);CREATE TABLE friend_tags(friend_id TEXT,tag_id TEXT,assigned_at TEXT,PRIMARY KEY(friend_id,tag_id));CREATE TABLE scenarios(id TEXT PRIMARY KEY,line_account_id TEXT,is_active INTEGER);CREATE TABLE messages_log(id TEXT,friend_id TEXT,line_account_id TEXT,direction TEXT,created_at TEXT);INSERT INTO line_accounts VALUES ('la','channel','synthetic-line-token','login-fixture','111-fixture',1,'2020');INSERT INTO friends VALUES ('friend','Ufixture','la','Fixture',1,'{}','2020','2020');`,
  );
  ls.exec(
    'CREATE TABLE account_settings(id TEXT PRIMARY KEY,line_account_id TEXT,key TEXT,value TEXT,UNIQUE(line_account_id,key))',
  );
  ls.exec(readFileSync(lineRoot + '/packages/db/migrations/073_x_line_first_gates.sql', 'utf8'));
  const secret = 'synthetic-cross-repo-shared-secret-not-real';
  xs.exec(
    "INSERT INTO x_accounts(id,x_user_id,username,access_token,created_at,updated_at) VALUES ('xa','999','brand','synthetic','2020','2020')",
  );
  xs.prepare(
    "INSERT INTO line_connections(id,name,worker_url,api_key,integration_secret,line_account_id,created_at) VALUES ('connection','LINE','https://line.example','line-admin',?,'la','2020')",
  ).run(secret);
  const xEnv = { DB: adapter(xs), API_KEY: 'x-admin', WORKER_URL: 'https://x.example' } as any;
  const lEnv = {
    DB: adapter(ls),
    API_KEY: 'line-admin',
    WORKER_URL: 'https://line.example',
    X_HARNESS_URL: 'https://x.example',
    X_HARNESS_CONNECTION_ID: 'connection',
    X_HARNESS_GATE_SECRET: secret,
  } as any;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => {},
  } as any;
  const lineApp = new Hono<any>();
  lineApp.use('*', async (c, next) => {
    c.set('staff', { id: 'owner', name: 'Owner', role: 'owner' });
    await next();
  });
  lineApp.route('/', xGates);
  let posts: any[] = [];
  let xWrites = 0;
  const delivered: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init),
        url = new URL(req.url);
      if (url.origin === 'https://line.example') {
        if (url.pathname.endsWith('/events')) delivered.push(req.clone());
        return lineApp.fetch(req, lEnv, ctx);
      }
      if (url.origin === 'https://x.example') {
        const response = await xWorker.fetch(req, xEnv, ctx);
        if (!response.ok)
          console.error(
            'Synthetic X response',
            url.pathname,
            response.status,
            await response.clone().text(),
          );
        return response;
      }
      if (url.origin === 'https://api.line.me') {
        if (url.pathname === '/oauth2/v2.1/verify')
          return Response.json(
            req.method === 'POST'
              ? { sub: 'Ufixture', name: 'Fixture' }
              : { client_id: 'login-fixture', expires_in: 3600 },
          );
        if (url.pathname === '/v2/profile') return Response.json({ userId: 'Ufixture' });
        if (url.pathname === '/friendship/v1/status') return Response.json({ friendFlag: true });
      }
      if (url.origin === 'https://api.x.com') {
        if (req.method !== 'GET') {
          xWrites++;
          throw new Error('Unexpected X write');
        }
        if (url.pathname === '/2/tweets/search/recent')
          return Response.json({
            data: posts,
            includes: {
              users: posts.length
                ? [
                    {
                      id: '123',
                      username: 'participant',
                      created_at: '2020-01-01T00:00:00Z',
                      public_metrics: { followers_count: 10 },
                    },
                  ]
                : [],
            },
            meta: {},
          });
        if (url.pathname === '/2/tweets/555')
          return Response.json({ data: { id: '555', author_id: '999', text: 'Announcement' } });
      }
      throw new Error('Unmocked origin/path: ' + url.origin + url.pathname);
    }),
  );
  const create = await xWorker.fetch(
    new Request('https://x.example/api/campaigns', {
      method: 'POST',
      headers: { Authorization: 'Bearer x-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'line_first',
        xAccountId: 'xa',
        lineConnectionId: 'connection',
        title: 'Fixture campaign',
        slug: 'spring',
        claimPhrase: '春プレ',
        postId: '555',
        endsAt: new Date(now + 86400000).toISOString(),
        tier: 'standard',
        rewards: [
          {
            label: 'Fixture gift',
            type: 'line_message',
            value: 'Synthetic reward',
            quota: 1,
            weight: 1,
          },
        ],
      }),
    }),
    xEnv,
    ctx,
  );
  expect(create.status).toBe(201);
  const gateId = ((await create.json()) as any).data.id;
  const liff = async (action: string) =>
    lineApp.fetch(
      new Request(`https://line.example/api/liff/x-gates/${gateId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: 'synthetic-id-token',
          accessToken: 'synthetic-access-token',
          lineFriendId: 'forged',
        }),
      }),
      lEnv,
      ctx,
    );
  const joined = await liff('join');
  expect(joined.status).toBe(200);
  const claim = ((await joined.json()) as any).data;
  expect(claim.status).toBe('awaiting_reply');
  expect(claim.displayCode).toMatch(/^春プレ-[A-HJKMNP-Z2-9]{5}$/);
  await Promise.all(pending);
  expect(sends).toHaveLength(0);
  posts = [
    {
      id: '1001',
      author_id: '123',
      text: claim.displayCode + ' 参加します',
      created_at: new Date(now + 1000).toISOString(),
      conversation_id: '555',
    },
  ];
  vi.setSystemTime(now + 20000);
  const checking = await liff('check');
  const checkingBody = (await checking.json()) as any;
  expect(checking.status, JSON.stringify(checkingBody)).toBe(200);
  expect(checkingBody.data.status).toBe('provisional');
  vi.setSystemTime(now + 90000);
  const final = await liff('check');
  const result = ((await final.json()) as any).data;
  expect(result.status).toBe('won');
  expect(result.rank).toBe(1);
  expect(result.display.message).toBe('先着 #1 で当選！ 残り 0 名');
  expect(result.campaign.remaining).toBe(0);
  expect(result.reward.value).toBe('Synthetic reward');
  await sendLineOutbox(xEnv, Date.now());
  await sendLineOutbox(xEnv, Date.now());
  expect(sends).toHaveLength(1);
  expect(sends[0].url).toBe('https://line.example/line-api/v2/bot/message/push');
  expect((await sends[0].json()).to).toBe('Ufixture');
  expect(xWrites).toBe(0);
  expect(xs.prepare('SELECT issued FROM gate_rewards WHERE gate_id=?').get(gateId)?.issued).toBe(1);
  expect(
    ls.prepare('SELECT external_id FROM friend_external_ids WHERE friend_id=?').get('friend')
      ?.external_id,
  ).toBe('123');
  const rewardEvent = delivered.find(
    (r) => r.headers.get('X-Harness-Event') === 'x.gate.reward_unlocked',
  )!;
  expect((await lineApp.fetch(rewardEvent.clone(), lEnv, ctx)).status).toBe(200);
  expect(sends).toHaveLength(1);
  ls.prepare(
    "INSERT INTO account_settings(id,line_account_id,key,value) VALUES ('config','la','x_campaign_digest_friend_ids',?)",
  ).run(JSON.stringify(['friend']));
  xs.exec(
    "INSERT INTO settings(key,value,updated_at) VALUES ('digest_channels','[\"line\"]','2026')",
  );
  xs.prepare('UPDATE engagement_gates SET ends_at=? WHERE id=?').run(
    new Date(Date.now() - 3600000).toISOString(),
    gateId,
  );
  await enqueueEndedDigests(xEnv);
  await enqueueEndedDigests(xEnv);
  await sendDigests(xEnv);
  await sendDigests(xEnv);
  expect(xs.prepare("SELECT COUNT(*) n FROM campaign_digests WHERE status='sent'").get()?.n).toBe(
    1,
  );
  expect(sends).toHaveLength(2);
  expect(xWrites).toBe(0);
});
