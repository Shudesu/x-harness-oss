import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockArticle: any = {
  id: 'art1',
  x_account_id: 'acc1',
  title: 'Test Article',
  body_md: '# Hello',
  image_url: null,
  theme: null,
  source_tweet_ids: null,
  status: 'draft',
  x_article_draft_id: null,
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
const setGrowthArticleXDraftIdMock = vi.fn(async () => {});
const getXAccountByIdMock = vi.fn(async () => ({
  id: 'acc1',
  consumer_key: 'consumer-key',
  consumer_secret: 'consumer-secret',
  access_token: 'access-token',
  access_token_secret: 'access-token-secret',
}));
const incrementApiUsageMock = vi.fn(async () => {});

const createArticleDraftMock = vi.fn(async () => ({ id: 'x-draft-1', title: 'Test Article' }));
const publishArticleMock = vi.fn(async () => ({ post_id: 'post-123' }));
const uploadMediaMock = vi.fn(async () => 'media-123');

vi.mock('@x-harness/x-sdk', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  XClient: class {
    createArticleDraft = createArticleDraftMock;
    publishArticle = publishArticleMock;
    uploadMedia = uploadMediaMock;
  },
}));

vi.mock('@x-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createGrowthArticle: (...a: any[]) => (createGrowthArticleMock as any)(...a),
  getGrowthArticles: (...a: any[]) => (getGrowthArticlesMock as any)(...a),
  getGrowthArticle: (...a: any[]) => (getGrowthArticleMock as any)(...a),
  updateGrowthArticle: (...a: any[]) => (updateGrowthArticleMock as any)(...a),
  getXAccountById: (...a: any[]) => (getXAccountByIdMock as any)(...a),
  incrementApiUsage: (...a: any[]) => (incrementApiUsageMock as any)(...a),
  setGrowthArticleXDraftId: (...a: any[]) => (setGrowthArticleXDraftIdMock as any)(...a),
  setGrowthArticleStatus: (...a: any[]) => (setGrowthArticleStatusMock as any)(...a),
}));

import { growthArticles } from '../growth-articles.js';

const env = { DB: {} } as any;

describe('/api/growth/articles routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGrowthArticleMock.mockResolvedValue({ ...mockArticle });
    createArticleDraftMock.mockResolvedValue({ id: 'x-draft-1', title: 'Test Article' });
    publishArticleMock.mockResolvedValue({ post_id: 'post-123' });
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

  it('publishes a Growth draft through create_article then publish_article', async () => {
    const req = new Request('http://local/api/growth/articles/art1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growthArticles.request(req, undefined, env);

    expect(res.status).toBe(200);
    expect(createArticleDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Test Article',
      content_state: expect.objectContaining({ blocks: expect.any(Array) }),
    }));
    expect(setGrowthArticleXDraftIdMock).toHaveBeenCalledWith({}, 'art1', 'x-draft-1');
    expect(publishArticleMock).toHaveBeenCalledWith('x-draft-1');
    expect(setGrowthArticleStatusMock).toHaveBeenCalledWith({}, 'art1', 'published', 'post-123');
    expect(incrementApiUsageMock).toHaveBeenCalledWith({}, 'acc1', 'article_draft');
    expect(incrementApiUsageMock).toHaveBeenCalledWith({}, 'acc1', 'article_publish');
    expect(await res.json()).toMatchObject({
      success: true,
      data: { article_id: 'x-draft-1', post_id: 'post-123' },
    });
  });

  it('retries publishing the saved X draft without creating a duplicate', async () => {
    getGrowthArticleMock.mockResolvedValueOnce({ ...mockArticle, x_article_draft_id: 'x-draft-existing' });
    const req = new Request('http://local/api/growth/articles/art1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growthArticles.request(req, undefined, env);

    expect(res.status).toBe(200);
    expect(createArticleDraftMock).not.toHaveBeenCalled();
    expect(setGrowthArticleXDraftIdMock).not.toHaveBeenCalled();
    expect(publishArticleMock).toHaveBeenCalledWith('x-draft-existing');
  });

  it('keeps the saved X draft retryable when publish_article fails', async () => {
    publishArticleMock.mockRejectedValueOnce(new Error('Premium required'));
    const req = new Request('http://local/api/growth/articles/art1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await growthArticles.request(req, undefined, env);

    expect(res.status).toBe(500);
    expect(setGrowthArticleXDraftIdMock).toHaveBeenCalledWith({}, 'art1', 'x-draft-1');
    expect(setGrowthArticleStatusMock).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ success: false, error: 'Premium required' });
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
