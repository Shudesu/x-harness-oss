import { it, expect, vi, afterEach } from 'vitest';
import { Hono } from '../../apps/worker/node_modules/hono/dist/index.js';
import { fixture, now } from '../helpers/campaign.js';
import worker from '../../apps/worker/src/index.js';
import { campaignInsights } from '../../apps/worker/src/routes/campaign-insights.js';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('serves a public status without identifiers or X requests and uses the normalized cache key', async () => {
  const f = fixture();
  const cache = new Map<string, Response>(),
    pending: Promise<unknown>[] = [];
  vi.stubGlobal('caches', {
    default: {
      match: async (r: Request) => cache.get(r.url)?.clone(),
      put: async (r: Request, response: Response) => {
        cache.set(r.url, response);
      },
    },
  });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const env = { DB: f.db, API_KEY: 'synthetic', WORKER_URL: 'https://x.example' } as any,
    ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
    } as any;
  const a = await worker.fetch(new Request('https://x.example/c/spring/status.json?v=1'), env, ctx);
  expect(a.status).toBe(200);
  const json = await a.json();
  expect(JSON.stringify(json)).not.toMatch(/gateId|line_friend_id|code|reward/);
  await Promise.all(pending);
  const prepare = vi.spyOn(f.db, 'prepare');
  const b = await worker.fetch(new Request('https://x.example/c/spring/status.json?v=2'), env, ctx);
  expect(b.status).toBe(200);
  expect(prepare).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  cache.clear();
  f.sqlite.prepare('UPDATE engagement_gates SET archived_at=?').run(now);
  const ended = await worker.fetch(new Request('https://x.example/c/spring/status.json'), env, ctx);
  expect(await ended.json()).toEqual({ state: 'ended' });
});
it('encrypts and masks Slack configuration and rejects misleading hosts', async () => {
  const f = fixture(),
    env = {
      DB: f.db,
      API_KEY: 'synthetic',
      WORKER_URL: 'https://x.example',
      ENCRYPTION_KEY: btoa('0123456789abcdef0123456789abcdef'),
    } as any,
    ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;
  const put = (value: string) =>
    worker.fetch(
      new Request('https://x.example/api/settings', {
        method: 'PUT',
        headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest_slack_webhook: value }),
      }),
      env,
      ctx,
    );
  expect((await put('https://hooks.slack.com.evil.test/services/test')).status).toBe(400);
  expect((await put('https://hooks.slack.com/services/synthetic/test')).status).toBe(200);
  expect(
    (f.sqlite.prepare("SELECT value FROM settings WHERE key='digest_slack_webhook'").get() as any)
      .value,
  ).not.toContain('https://');
  const response = await worker.fetch(
    new Request('https://x.example/api/settings', {
      headers: { Authorization: 'Bearer synthetic' },
    }),
    env,
    ctx,
  );
  expect(((await response.json()) as any).data.digest_slack_webhook).toBe('(set)');
});
it('allows editors to draft and read digests, but rejects viewers and editor test sends', async () => {
  const f = fixture(),
    app = new Hono<any>();
  let role = 'editor';
  app.use('*', async (c, next) => {
    c.set('staffRole', role);
    await next();
  });
  app.route('/', campaignInsights);
  const req = () =>
    app.request(
      '/api/campaigns/draft',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xAccountId: 'a', brief: '春の企画' }),
      },
      { DB: f.db },
    );
  expect((await req()).status).toBe(200);
  expect(
    (
      await app.request(
        '/api/campaigns/g/digest/test',
        { method: 'POST', body: '{}' },
        { DB: f.db },
      )
    ).status,
  ).toBe(403);
  role = 'viewer';
  expect((await req()).status).toBe(403);
  expect((await app.request('/api/campaigns/g/digest', undefined, { DB: f.db })).status).toBe(403);
});
