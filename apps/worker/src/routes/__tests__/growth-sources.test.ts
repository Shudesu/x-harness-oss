import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks ---
const upsertSourceCandidateMock = vi.fn(async (_db: any, c: any) => ({
  id: 'src1',
  source_tweet_id: c.sourceTweetId,
  author: c.author,
  author_url: c.authorUrl ?? null,
  text_en: c.textEn,
  text_ja: c.textJa,
  summary_ja: c.summaryJa ?? null,
  suggested_quote_text: c.suggestedQuoteText ?? null,
  video_url: c.videoUrl ?? null,
  views: c.views,
  likes: c.likes,
  theme: c.theme ?? null,
  status: 'new',
  discovered_at: '2026-07-11 00:00:00',
  created_at: '2026-07-11 00:00:00',
  updated_at: '2026-07-11 00:00:00',
}));

const getSourceCandidatesMock = vi.fn(async () => [
  {
    id: 'src1',
    source_tweet_id: 'tweet123',
    author: 'elonmusk',
    author_url: null,
    text_en: 'AI is the future',
    text_ja: 'AIは未来だ',
    summary_ja: null,
    suggested_quote_text: null,
    video_url: null,
    views: 50000,
    likes: 1000,
    theme: null,
    status: 'new',
    discovered_at: '2026-07-11 00:00:00',
    created_at: '2026-07-11 00:00:00',
    updated_at: '2026-07-11 00:00:00',
  },
]);

const getSourceCandidateMock = vi.fn(async (_db: any, id: string) => ({
  id,
  source_tweet_id: 'tweet123',
  author: 'elonmusk',
  author_url: null,
  text_en: 'AI is the future',
  text_ja: 'AIは未来だ',
  summary_ja: null,
  suggested_quote_text: null,
  video_url: null,
  views: 50000,
  likes: 1000,
  theme: null,
  status: 'new',
  discovered_at: '2026-07-11 00:00:00',
  created_at: '2026-07-11 00:00:00',
  updated_at: '2026-07-11 00:00:00',
}));

const setSourceCandidateStatusMock = vi.fn(async () => {});

const createGrowthDraftMock = vi.fn(async (_db: any, d: any) => ({
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

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  upsertSourceCandidate: (...a: any[]) => (upsertSourceCandidateMock as any)(...a),
  getSourceCandidates: (...a: any[]) => (getSourceCandidatesMock as any)(...a),
  getSourceCandidate: (...a: any[]) => (getSourceCandidateMock as any)(...a),
  setSourceCandidateStatus: (...a: any[]) => (setSourceCandidateStatusMock as any)(...a),
  createGrowthDraft: (...a: any[]) => (createGrowthDraftMock as any)(...a),
}));

import { growthSources } from '../growth-sources.js';

const env = { DB: {} } as any;

describe('/api/growth/sources routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1: POST /api/growth/sources → 201
  it('POST /api/growth/sources returns 201 with upserted candidate', async () => {
    const req = new Request('http://local/api/growth/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceTweetId: 'tweet123',
        author: 'elonmusk',
        textEn: 'AI is the future',
        textJa: 'AIは未来だ',
        views: 50000,
        likes: 1000,
      }),
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('src1');
    expect(body.data.status).toBe('new');
    expect(upsertSourceCandidateMock).toHaveBeenCalledWith({}, {
      sourceTweetId: 'tweet123',
      author: 'elonmusk',
      authorUrl: undefined,
      textEn: 'AI is the future',
      textJa: 'AIは未来だ',
      summaryJa: undefined,
      suggestedQuoteText: undefined,
      videoUrl: undefined,
      views: 50000,
      likes: 1000,
      theme: undefined,
    });
  });

  // Case 1b: POST /api/growth/sources → 400 when required fields missing
  it('POST /api/growth/sources returns 400 when required fields missing', async () => {
    const req = new Request('http://local/api/growth/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceTweetId: 'tweet123', author: 'elonmusk' }),
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(400);
  });

  // Case 2: GET /api/growth/sources?status=new → list
  it('GET /api/growth/sources?status=new returns candidate list', async () => {
    const req = new Request('http://local/api/growth/sources?status=new', {
      method: 'GET',
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe('src1');
    expect(getSourceCandidatesMock).toHaveBeenCalledWith({}, { status: 'new' });
  });

  // Case 3: POST /api/growth/sources/:id/to-draft → createGrowthDraft with quoteTweetId + status drafted
  it('POST /api/growth/sources/:id/to-draft delegates to createGrowthDraft with quoteTweetId=source_tweet_id and sets status drafted', async () => {
    const req = new Request('http://local/api/growth/sources/src1/to-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'acc1',
        text: '引用コメント',
        scheduledAt: '2026-07-12 08:00:00',
      }),
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    // createGrowthDraft called with quoteTweetId = candidate.source_tweet_id
    expect(createGrowthDraftMock).toHaveBeenCalledWith({}, {
      xAccountId: 'acc1',
      type: 'quote_rt',
      text: '引用コメント',
      quoteTweetId: 'tweet123',
      scheduledAt: '2026-07-12 08:00:00',
    });
    // setSourceCandidateStatus called with 'drafted'
    expect(setSourceCandidateStatusMock).toHaveBeenCalledWith({}, 'src1', 'drafted');
    expect(body.data.draft.id).toBe('draft1');
    expect(body.data.candidate.id).toBe('src1');
  });

  // Case 4: to-draft on already-drafted candidate → 409
  it('POST /api/growth/sources/:id/to-draft returns 409 when candidate status is not new', async () => {
    getSourceCandidateMock.mockResolvedValueOnce({
      id: 'src1',
      source_tweet_id: 'tweet123',
      author: 'elonmusk',
      author_url: null,
      text_en: 'AI is the future',
      text_ja: 'AIは未来だ',
      summary_ja: null,
      suggested_quote_text: null,
      video_url: null,
      views: 50000,
      likes: 1000,
      theme: null,
      status: 'drafted', // already drafted
      discovered_at: '2026-07-11 00:00:00',
      created_at: '2026-07-11 00:00:00',
      updated_at: '2026-07-11 00:00:00',
    });
    const req = new Request('http://local/api/growth/sources/src1/to-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'acc1',
        text: '引用コメント',
        scheduledAt: '2026-07-12 08:00:00',
      }),
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(409);
    expect(createGrowthDraftMock).not.toHaveBeenCalled();
  });

  // Case 5: POST /api/growth/sources/:id/dismiss → sets status dismissed
  it('POST /api/growth/sources/:id/dismiss sets status to dismissed', async () => {
    const req = new Request('http://local/api/growth/sources/src1/dismiss', {
      method: 'POST',
    });
    const res = await growthSources.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(setSourceCandidateStatusMock).toHaveBeenCalledWith({}, 'src1', 'dismissed');
  });
});
