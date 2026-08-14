import { describe, it, expect, vi, beforeEach } from 'vitest';

const createGrowthDraftMock = vi.fn(async (db: any, d: any) => ({
  id: 'draft1',
  x_account_id: d.xAccountId,
  type: d.type,
  text: d.text,
  quote_tweet_id: d.quoteTweetId ?? null,
  scheduled_at: d.scheduledAt,
  status: 'pending',
  scheduled_post_id: null,
  created_at: '2026-07-11 00:00:00',
  updated_at: '2026-07-11 00:00:00',
}));

const getGrowthDraftsMock = vi.fn(async () => []);

// Far-future slot so resolveApprovedSlot passes it through unchanged.
const FUTURE_SLOT = '2099-01-01T08:00:00+09:00';

const getGrowthDraftMock = vi.fn(async (_db: any, id: string) => ({
  id,
  x_account_id: 'acc1',
  type: 'pillar',
  text: 'hello',
  quote_tweet_id: 'qt99',
  scheduled_at: FUTURE_SLOT,
  status: 'pending',
  scheduled_post_id: null,
  created_at: '2026-07-11 00:00:00',
  updated_at: '2026-07-11 00:00:00',
}));

const updateGrowthDraftMock = vi.fn(async () => {});

const setGrowthDraftStatusMock = vi.fn(async () => {});

const upsertGrowthDigestMock = vi.fn(async () => {});

const getLatestGrowthDigestMock = vi.fn(async () => null);

const getGrowthDigestByDateMock = vi.fn(async () => null);

// Pass-through by default; tests override to simulate a bumped/rolled slot.
const resolveFreeSlotMock = vi.fn(async (..._a: any[]) => _a[2] as string);

const createScheduledPostMock = vi.fn(async (...args: any[]) => ({
  id: 'sp1',
  x_account_id: args[1],
  text: args[2],
  media_ids: null,
  quote_tweet_id: args[5] ?? null,
  scheduled_at: args[3],
  status: 'scheduled',
  posted_tweet_id: null,
  created_at: '2026-07-11 00:00:00',
  updated_at: '2026-07-11 00:00:00',
}));

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createGrowthDraft: (...a: any[]) => createGrowthDraftMock(...a),
  getGrowthDrafts: (...a: any[]) => getGrowthDraftsMock(...a),
  getGrowthDraft: (...a: any[]) => getGrowthDraftMock(...a),
  updateGrowthDraft: (...a: any[]) => updateGrowthDraftMock(...a),
  setGrowthDraftStatus: (...a: any[]) => setGrowthDraftStatusMock(...a),
  upsertGrowthDigest: (...a: any[]) => upsertGrowthDigestMock(...a),
  getLatestGrowthDigest: (...a: any[]) => getLatestGrowthDigestMock(...a),
  getGrowthDigestByDate: (...a: any[]) => getGrowthDigestByDateMock(...a),
  createScheduledPost: (...a: any[]) => createScheduledPostMock(...a),
  resolveFreeSlot: (...a: any[]) => resolveFreeSlotMock(...a),
}));

import { growth } from '../growth.js';

const env = { DB: {} } as any;

describe('/api/growth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1: POST /api/growth/drafts → 201
  it('POST /api/growth/drafts returns 201 with created draft', async () => {
    const req = new Request('http://local/api/growth/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'acc1',
        type: 'pillar',
        text: 'hello world',
        scheduledAt: '2026-07-12 08:00:00',
      }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('draft1');
    expect(body.data.status).toBe('pending');
    expect(createGrowthDraftMock).toHaveBeenCalledWith({}, {
      xAccountId: 'acc1',
      type: 'pillar',
      text: 'hello world',
      scheduledAt: '2026-07-12 08:00:00',
      quoteTweetId: undefined,
    });
  });

  // Case 2: POST /api/growth/drafts → 400 on missing fields
  it('POST /api/growth/drafts returns 400 when required fields missing', async () => {
    const req = new Request('http://local/api/growth/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1' }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(400);
  });

  // Case 3: approve passes quoteTweetId to createScheduledPost + status transitions
  it('POST /api/growth/drafts/:id/approve delegates to createScheduledPost with quote and transitions status', async () => {
    const req = new Request('http://local/api/growth/drafts/draft1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    // createScheduledPost called with (DB, xAccountId, text, scheduledAt, undefined, quoteTweetId)
    expect(createScheduledPostMock).toHaveBeenCalledWith(
      {},
      'acc1',
      'hello',
      FUTURE_SLOT,
      undefined,
      'qt99',
    );
    // setGrowthDraftStatus called with 'scheduled' and the scheduled post id
    expect(setGrowthDraftStatusMock).toHaveBeenCalledWith({}, 'draft1', 'scheduled', 'sp1');
    expect(body.data.scheduledPostId).toBe('sp1');
  });

  // Case 3b: approve resolves the slot with rollStale (stale drafts must not
  // fire immediately) and schedules + syncs the draft row to the resolved slot.
  it('approve schedules at the conflict-resolved slot and syncs the draft row', async () => {
    const RESOLVED = '2099-01-01T09:00:00.000+09:00';
    resolveFreeSlotMock.mockResolvedValueOnce(RESOLVED);
    const res = await growth.request(
      new Request('http://local/api/growth/drafts/draft1/approve', { method: 'POST', body: '{}' }),
      undefined,
      env,
    );
    expect(res.status).toBe(200);
    expect(resolveFreeSlotMock).toHaveBeenCalledWith({}, 'acc1', FUTURE_SLOT, { rollStale: true });
    expect(createScheduledPostMock.mock.calls[0][3]).toBe(RESOLVED);
    // Draft row is kept in sync with the resolved slot
    expect(updateGrowthDraftMock).toHaveBeenCalledWith({}, 'draft1', { scheduledAt: RESOLVED });
    const body = await res.json() as any;
    expect(body.data.scheduled_at).toBe(RESOLVED);
  });

  // Case 3c: untouched slot → no draft-row rewrite.
  it('approve does not rewrite the draft when the slot is unchanged', async () => {
    const res = await growth.request(
      new Request('http://local/api/growth/drafts/draft1/approve', { method: 'POST', body: '{}' }),
      undefined,
      env,
    );
    expect(res.status).toBe(200);
    expect(createScheduledPostMock.mock.calls[0][3]).toBe(FUTURE_SLOT);
    expect(updateGrowthDraftMock).not.toHaveBeenCalled();
  });

  // Case 4: approve of non-pending draft → 409
  it('POST /api/growth/drafts/:id/approve returns 409 when draft is not pending', async () => {
    getGrowthDraftMock.mockResolvedValueOnce({
      id: 'draft1',
      x_account_id: 'acc1',
      type: 'pillar',
      text: 'hello',
      quote_tweet_id: null,
      scheduled_at: '2026-07-12 08:00:00',
      status: 'scheduled', // not pending
      scheduled_post_id: 'sp1',
      created_at: '2026-07-11 00:00:00',
      updated_at: '2026-07-11 00:00:00',
    });
    const req = new Request('http://local/api/growth/drafts/draft1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(409);
  });

  // Case 5: PATCH /api/growth/drafts/:id updates text and returns updated draft
  it('PATCH /api/growth/drafts/:id returns 200 with updated draft', async () => {
    // First call: fetch existing draft to check status
    // Second call: fetch after update
    getGrowthDraftMock
      .mockResolvedValueOnce({
        id: 'draft1',
        x_account_id: 'acc1',
        type: 'pillar',
        text: 'hello',
        quote_tweet_id: 'qt99',
        scheduled_at: '2026-07-12 08:00:00',
        status: 'pending',
        scheduled_post_id: null,
        created_at: '2026-07-11 00:00:00',
        updated_at: '2026-07-11 00:00:00',
      })
      .mockResolvedValueOnce({
        id: 'draft1',
        x_account_id: 'acc1',
        type: 'pillar',
        text: 'updated text',
        quote_tweet_id: 'qt99',
        scheduled_at: '2026-07-12 08:00:00',
        status: 'pending',
        scheduled_post_id: null,
        created_at: '2026-07-11 00:00:00',
        updated_at: '2026-07-11 01:00:00',
      });
    const req = new Request('http://local/api/growth/drafts/draft1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'updated text' }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    expect(updateGrowthDraftMock).toHaveBeenCalledWith({}, 'draft1', { text: 'updated text', scheduledAt: undefined });
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.text).toBe('updated text');
    expect(body.data.updated_at).toBe('2026-07-11 01:00:00');
  });

  // Case 6: PATCH on non-pending draft → 409
  it('PATCH /api/growth/drafts/:id returns 409 when not pending', async () => {
    getGrowthDraftMock.mockResolvedValueOnce({
      id: 'draft1',
      x_account_id: 'acc1',
      type: 'pillar',
      text: 'hello',
      quote_tweet_id: null,
      scheduled_at: '2026-07-12 08:00:00',
      status: 'rejected',
      scheduled_post_id: null,
      created_at: '2026-07-11 00:00:00',
      updated_at: '2026-07-11 00:00:00',
    });
    const req = new Request('http://local/api/growth/drafts/draft1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'updated text' }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(409);
  });

  // Case 7: POST /api/growth/digest upsert with shallow merge (same date)
  it('POST /api/growth/digest upserts payload (shallow merge when existing for same date)', async () => {
    // Simulate existing digest for the same date
    getGrowthDigestByDateMock.mockResolvedValueOnce({
      date: '2026-07-11',
      payload: JSON.stringify({ existingKey: 'existingVal', overwriteMe: 'old' }),
    });
    const req = new Request('http://local/api/growth/digest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-11', payload: { newKey: 'newVal', overwriteMe: 'new' } }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    // upsertGrowthDigest should be called with merged payload
    const calledPayload = JSON.parse(upsertGrowthDigestMock.mock.calls[0][2]);
    expect(calledPayload.existingKey).toBe('existingVal');
    expect(calledPayload.newKey).toBe('newVal');
    expect(calledPayload.overwriteMe).toBe('new');
    // Verify getGrowthDigestByDate was called with the target date
    expect(getGrowthDigestByDateMock).toHaveBeenCalledWith({}, '2026-07-11');
  });

  // Case 7b: Cross-date digest scenario (target date exists but newer date also exists)
  it('POST /api/growth/digest merges only with same date (cross-date test)', async () => {
    // Target date: 2026-07-11 (has existing payload)
    // Newer date: 2026-07-12 (should NOT affect merge)
    getGrowthDigestByDateMock.mockResolvedValueOnce({
      date: '2026-07-11',
      payload: JSON.stringify({ key1: 'val1', shared: 'old' }),
    });
    const req = new Request('http://local/api/growth/digest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-11', payload: { key3: 'val3', shared: 'new' } }),
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    // Merged payload should only contain key1 (from target date), key3 (new), and shared='new'
    const calledPayload = JSON.parse(upsertGrowthDigestMock.mock.calls[0][2]);
    expect(calledPayload.key1).toBe('val1');
    expect(calledPayload.key3).toBe('val3');
    expect(calledPayload.shared).toBe('new');
    // Verify date-scoped lookup was used
    expect(getGrowthDigestByDateMock).toHaveBeenCalledWith({}, '2026-07-11');
  });

  // Case 8: GET /api/growth/digest/latest → null when no digest
  it('GET /api/growth/digest/latest returns data:null when no digest', async () => {
    getLatestGrowthDigestMock.mockImplementationOnce(async () => null);
    const req = new Request('http://local/api/growth/digest/latest', {
      method: 'GET',
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  // Case 9: GET /api/growth/digest/latest → parsed payload
  it('GET /api/growth/digest/latest returns parsed payload', async () => {
    getLatestGrowthDigestMock.mockImplementationOnce(async () => ({
      date: '2026-07-11',
      payload: JSON.stringify({ foo: 'bar' }),
    }));
    const req = new Request('http://local/api/growth/digest/latest', {
      method: 'GET',
    });
    const res = await growth.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.date).toBe('2026-07-11');
    expect(body.data.payload.foo).toBe('bar');
  });
});
