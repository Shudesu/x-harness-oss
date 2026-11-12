import { describe, it, expect } from 'vitest';
import { sqliteD1, readBootstrapSql } from '../../../../../test-support/sqlite-d1.mjs';
import { posts } from '../posts.js';
import { health } from '../health.js';

const BOOTSTRAP = readBootstrapSql();

function setup() {
  const { d1, raw } = sqliteD1(BOOTSTRAP);
  const insert = raw.prepare(
    'INSERT INTO scheduled_posts (id, x_account_id, text, scheduled_at, status, posted_tweet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const now = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 19) + '+09:00';
  insert.run('s1', 'acc1', 'soon', '2099-01-01T08:00:00+09:00', 'scheduled', null, now, now);
  insert.run('s2', 'acc1', 'later', '2099-01-02T08:00:00+09:00', 'scheduled', null, now, now);
  insert.run('f1', 'acc1', 'failed old', '2026-01-01T08:00:00+09:00', 'failed', null, now, now);
  insert.run('f2', 'acc1', 'failed new', '2026-01-03T08:00:00+09:00', 'failed', null, now, now);
  insert.run('p1', 'acc1', 'posted', '2026-01-02T08:00:00+09:00', 'posted', '123', now, now);
  insert.run('fx', 'acc1', 'failed but accepted', '2026-01-04T08:00:00+09:00', 'failed', '999', now, now);
  raw.prepare('INSERT INTO scheduled_post_claims (post_id, claimed_at) VALUES (?, ?)').run('f1', now);
  const env = { DB: d1 };
  const call = (path: string, init?: RequestInit) => posts.request(path, init, env);
  return { raw, env, call };
}

describe('GET /api/posts/scheduled', () => {
  it('keeps the legacy shape: only scheduled posts, soonest first, unpaginated', async () => {
    const { call } = setup();
    const res = await call('/api/posts/scheduled');
    const body = await res.json() as { data: Array<{ id: string; status: string }> };
    expect(res.status).toBe(200);
    expect(body.data.map((p) => p.id)).toEqual(['s1', 's2']);
  });

  it('lists failed posts newest first with paging', async () => {
    const { call } = setup();
    const res = await call('/api/posts/scheduled?status=failed&limit=1&offset=0');
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((p) => p.id)).toEqual(['fx']);
    const page2 = await (await call('/api/posts/scheduled?status=failed&limit=2&offset=1')).json() as { data: Array<{ id: string }> };
    expect(page2.data.map((p) => p.id)).toEqual(['f2', 'f1']);
  });

  it('rejects unknown statuses and bad paging', async () => {
    const { call } = setup();
    expect((await call('/api/posts/scheduled?status=nope')).status).toBe(400);
    expect((await call('/api/posts/scheduled?status=all&limit=0')).status).toBe(400);
    expect((await call('/api/posts/scheduled?status=all&limit=501')).status).toBe(400);
  });
});

describe('POST /api/posts/scheduled/:id/requeue', () => {
  it('moves a failed post back to scheduled and releases its send claim', async () => {
    const { call, raw } = setup();
    const refused = await call('/api/posts/scheduled/f1/requeue', { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM scheduled_post_claims WHERE post_id = 'f1'").get()).toMatchObject({ n: 1 });
    const res = await call('/api/posts/scheduled/f1/requeue', { method: 'POST', body: JSON.stringify({ confirmNotPosted: true }) });
    expect(res.status).toBe(200);
    const row = raw.prepare("SELECT status FROM scheduled_posts WHERE id = 'f1'").get() as { status: string };
    expect(row.status).toBe('scheduled');
    expect(raw.prepare("SELECT COUNT(*) AS n FROM scheduled_post_claims WHERE post_id = 'f1'").get()).toMatchObject({ n: 0 });
  });

  it('requeues an unclaimed failed post without confirmation', async () => {
    const { call, raw } = setup();
    expect((await call('/api/posts/scheduled/f2/requeue', { method: 'POST' })).status).toBe(200);
    expect(raw.prepare("SELECT status FROM scheduled_posts WHERE id = 'f2'").get()).toMatchObject({ status: 'scheduled' });
  });

  it('refuses posts X already accepted, non-failed posts, and malformed bodies', async () => {
    const { call } = setup();
    expect((await call('/api/posts/scheduled/fx/requeue', { method: 'POST' })).status).toBe(409);
    expect((await call('/api/posts/scheduled/s1/requeue', { method: 'POST' })).status).toBe(409);
    expect((await call('/api/posts/scheduled/missing/requeue', { method: 'POST' })).status).toBe(404);
    expect((await call('/api/posts/scheduled/f2/requeue', { method: 'POST', body: '{bad' })).status).toBe(400);
  });
});

describe('GET /api/health/details', () => {
  it('reports recent failures and pending drafts', async () => {
    const { env } = setup();
    const res = await health.request('/api/health/details', undefined, env);
    const body = await res.json() as { data: { status: string; problems: string[]; scheduledPosts: { last24h: { failed: number } }; growthDrafts: { pending: number | null } } };
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('degraded');
    expect(body.data.problems).toContain('scheduled_posts_failed_last_24h');
    expect(body.data.scheduledPosts.last24h.failed).toBe(3);
    expect(body.data.growthDrafts.pending).toBe(0);
  });
});

describe('GET /api/health/details without the expected tables', () => {
  it('reports failed checks as degraded instead of healthy', async () => {
    const { d1 } = sqliteD1([]);
    const res = await health.request('/api/health/details', undefined, { DB: d1 });
    const body = await res.json() as { data: { status: string; problems: string[] } };
    expect(body.data.status).toBe('degraded');
    expect(body.data.problems.some((p) => p.startsWith('query_failed'))).toBe(true);
  });
});
