import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockArticle = {
  id: 'art1',
  x_account_id: 'acc1',
  title: 'Test Article',
  body_md: '# Hello',
  image_url: null,
  theme: null,
  source_tweet_ids: null,
  status: 'draft',
  published_article_id: null,
  created_at: '2026-07-12 00:00:00',
  updated_at: '2026-07-12 00:00:00',
};

const createGrowthArticleMock = vi.fn(async (_db: any, a: any) => ({
  ...mockArticle,
  x_account_id: a.xAccountId,
  title: a.title,
  body_md: a.bodyMd,
  image_url: a.imageUrl ?? null,
  theme: a.theme ?? null,
  source_tweet_ids: a.sourceTweetIds ?? null,
}));

const getGrowthArticlesMock = vi.fn(async () => [mockArticle]);

const getGrowthArticleMock = vi.fn(async (_db: any, id: string) => ({
  ...mockArticle,
  id,
}));

const updateGrowthArticleMock = vi.fn(async () => {});

const setGrowthArticleStatusMock = vi.fn(async () => {});

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createGrowthArticle: (...a: any[]) => createGrowthArticleMock(...a),
  getGrowthArticles: (...a: any[]) => getGrowthArticlesMock(...a),
  getGrowthArticle: (...a: any[]) => getGrowthArticleMock(...a),
  updateGrowthArticle: (...a: any[]) => updateGrowthArticleMock(...a),
  setGrowthArticleStatus: (...a: any[]) => setGrowthArticleStatusMock(...a),
}));

import { growthArticles } from '../growth-articles.js';

const env = { DB: {} } as any;

describe('/api/growth/articles routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGrowthArticleMock.mockResolvedValue({ ...mockArticle });
  });

  // Case 1: POST /api/growth/articles → 201
  it('POST /api/growth/articles returns 201 with created article', async () => {
    const req = new Request('http://local/api/growth/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        xAccountId: 'acc1',
        title: 'Test Article',
        bodyMd: '# Hello',
        sourceTweetIds: ['t1', 't2'],
      }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('draft');
    expect(createGrowthArticleMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        xAccountId: 'acc1',
        title: 'Test Article',
        bodyMd: '# Hello',
        sourceTweetIds: JSON.stringify(['t1', 't2']),
      }),
    );
  });

  // Case 2: POST /api/growth/articles → 400 when required fields missing
  it('POST /api/growth/articles returns 400 when required fields missing', async () => {
    const req = new Request('http://local/api/growth/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xAccountId: 'acc1', title: 'Only title' }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  // Case 3: GET /api/growth/articles?status=draft → list
  it('GET /api/growth/articles returns list of articles', async () => {
    const req = new Request('http://local/api/growth/articles?status=draft', {
      method: 'GET',
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(getGrowthArticlesMock).toHaveBeenCalledWith({}, { status: 'draft' });
  });

  // Case 4: PATCH /api/growth/articles/:id updates draft and returns data
  it('PATCH /api/growth/articles/:id updates draft and returns updated article', async () => {
    getGrowthArticleMock
      .mockResolvedValueOnce({ ...mockArticle, status: 'draft' })
      .mockResolvedValueOnce({ ...mockArticle, title: 'Updated Title', updated_at: '2026-07-12 01:00:00' });

    const req = new Request('http://local/api/growth/articles/art1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('Updated Title');
    expect(updateGrowthArticleMock).toHaveBeenCalledWith({}, 'art1', { title: 'Updated Title', bodyMd: undefined, imageUrl: undefined });
  });

  // Case 4b: PATCH on non-draft article → 409
  it('PATCH /api/growth/articles/:id returns 409 when not draft', async () => {
    getGrowthArticleMock.mockResolvedValueOnce({ ...mockArticle, status: 'published' });

    const req = new Request('http://local/api/growth/articles/art1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(409);
  });

  // Case 5: POST /api/growth/articles/:id/publish calls setGrowthArticleStatus with publishedArticleId
  it('POST /api/growth/articles/:id/publish transitions draft to published', async () => {
    getGrowthArticleMock.mockResolvedValueOnce({ ...mockArticle, status: 'draft' });

    const req = new Request('http://local/api/growth/articles/art1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishedArticleId: 'pub123' }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(setGrowthArticleStatusMock).toHaveBeenCalledWith({}, 'art1', 'published', 'pub123');
  });

  // Case 5b: POST /api/growth/articles/:id/publish on non-draft → 409
  it('POST /api/growth/articles/:id/publish returns 409 when not draft', async () => {
    getGrowthArticleMock.mockResolvedValueOnce({ ...mockArticle, status: 'published' });

    const req = new Request('http://local/api/growth/articles/art1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishedArticleId: 'pub123' }),
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(409);
  });

  // Case 6: POST /api/growth/articles/:id/discard calls setGrowthArticleStatus discarded
  it('POST /api/growth/articles/:id/discard transitions to discarded', async () => {
    getGrowthArticleMock.mockResolvedValueOnce({ ...mockArticle, status: 'draft' });

    const req = new Request('http://local/api/growth/articles/art1/discard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growthArticles.request(req, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(setGrowthArticleStatusMock).toHaveBeenCalledWith({}, 'art1', 'discarded');
  });
});
