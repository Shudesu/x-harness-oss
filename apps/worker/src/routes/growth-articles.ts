import { Hono } from 'hono';
import {
  createGrowthArticle,
  getGrowthArticles,
  getGrowthArticle,
  getXAccountById,
  incrementApiUsage,
  updateGrowthArticle,
  setGrowthArticleXDraftId,
  setGrowthArticleStatus,
} from '@x-harness/db';
import {
  InlineImageError,
  buildXClient,
  errorMessage,
  markdownToContentState,
  uploadArticleCover,
  uploadInlineImages,
} from './articles.js';
import type { Env } from '../index.js';

const growthArticles = new Hono<Env>();

// POST /api/growth/articles/image — store a header image in R2, return its public URL.
// Auth is handled by the global Bearer middleware. The served URL below is public
// (keyed by an unguessable UUID) so <img> tags on the dashboard can load it.
growthArticles.post('/api/growth/articles/image', async (c) => {
  if (!c.env.GROWTH_IMAGES) return c.json({ success: false, error: 'R2 not configured' }, 500);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return c.json({ success: false, error: 'file is required' }, 400);
  }
  const base = (c.env.WORKER_URL || '').replace(/\/$/, '');
  if (!base) return c.json({ success: false, error: 'WORKER_URL not configured' }, 500);
  // Pipeline always uploads PNG (codex imagegen output); store as .png with matching type.
  const key = `growth/${crypto.randomUUID()}.png`;
  await c.env.GROWTH_IMAGES.put(key, await (file as Blob).arrayBuffer(), {
    httpMetadata: { contentType: 'image/png' },
  });
  return c.json({ success: true, data: { url: `${base}/api/growth/img/${key.split('/')[1]}` } }, 201);
});

// GET /api/growth/img/:name — public image serve from R2 (no auth; UUID key is the secret)
growthArticles.get('/api/growth/img/:name', async (c) => {
  if (!c.env.GROWTH_IMAGES) return c.notFound();
  const obj = await c.env.GROWTH_IMAGES.get(`growth/${c.req.param('name')}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/png', 'Cache-Control': 'public, max-age=31536000' },
  });
});

// POST /api/growth/articles — create article draft
growthArticles.post('/api/growth/articles', async (c) => {
  const body = await c.req.json<{
    xAccountId?: string;
    title?: string;
    bodyMd?: string;
    imageUrl?: string;
    theme?: string;
    sourceTweetIds?: string[];
  }>();
  const { xAccountId, title, bodyMd, imageUrl, theme, sourceTweetIds } = body;
  if (!xAccountId || !title || !bodyMd) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, title, bodyMd' }, 400);
  }
  const article = await createGrowthArticle(c.env.DB, {
    xAccountId,
    title,
    bodyMd,
    imageUrl,
    theme,
    sourceTweetIds: Array.isArray(sourceTweetIds) ? JSON.stringify(sourceTweetIds) : sourceTweetIds,
  });
  return c.json({ success: true, data: article }, 201);
});

// GET /api/growth/articles — list articles with optional status filter
growthArticles.get('/api/growth/articles', async (c) => {
  const status = c.req.query('status');
  const articles = await getGrowthArticles(c.env.DB, { status });
  return c.json({ success: true, data: articles });
});

// PATCH /api/growth/articles/:id — partial update (draft only)
growthArticles.patch('/api/growth/articles/:id', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  if (article.status !== 'draft') {
    return c.json({ success: false, error: 'Article is not a draft' }, 409);
  }
  const body = await c.req.json<{ title?: string; bodyMd?: string; imageUrl?: string }>();
  await updateGrowthArticle(c.env.DB, id, { title: body.title, bodyMd: body.bodyMd, imageUrl: body.imageUrl });
  const updated = await getGrowthArticle(c.env.DB, id);
  return c.json({ success: true, data: updated });
});

// POST /api/growth/articles/:id/publish — create the X Article draft, publish
// it, then mark the Growth draft as published. If X draft creation succeeds
// but publishing fails, x_article_draft_id is retained so a retry does not
// consume another slot from X's 10-drafts-per-24h quota.
//
// Legacy callers may still send { publishedArticleId } after publishing via
// MCP/API; that path only records the already-published post ID.
growthArticles.post('/api/growth/articles/:id/publish', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  if (article.status !== 'draft') {
    return c.json({ success: false, error: 'Article is not a draft' }, 409);
  }
  const body: { publishedArticleId?: string } = await c.req
    .json<{ publishedArticleId?: string }>()
    .catch(() => ({}));
  if (body.publishedArticleId) {
    await setGrowthArticleStatus(c.env.DB, id, 'published', body.publishedArticleId);
    return c.json({ success: true, data: { post_id: body.publishedArticleId } });
  }

  const account = await getXAccountById(c.env.DB, article.x_account_id);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = buildXClient(account);

  try {
    let xArticleDraftId = article.x_article_draft_id;
    if (!xArticleDraftId) {
      const source = { workerUrl: c.env.WORKER_URL, growthImages: c.env.GROWTH_IMAGES };
      const [mediaMap, coverMediaId] = await Promise.all([
        uploadInlineImages(article.body_md, xClient, source),
        article.image_url ? uploadArticleCover(article.image_url, xClient, source) : Promise.resolve(undefined),
      ]);
      const draft = await xClient.createArticleDraft({
        title: article.title,
        content_state: markdownToContentState(article.body_md, mediaMap, article.title),
        ...(coverMediaId
          ? { cover_media: { media_id: coverMediaId, media_category: 'tweet_image' } }
          : {}),
      });
      xArticleDraftId = draft.id;
      await setGrowthArticleXDraftId(c.env.DB, id, xArticleDraftId);
      // Usage logging must never turn a successful X mutation into a failed
      // response (which could tempt the caller to create a duplicate draft).
      await incrementApiUsage(c.env.DB, account.id, 'article_draft').catch(() => {});
    }

    const result = await xClient.publishArticle(xArticleDraftId);
    await setGrowthArticleStatus(c.env.DB, id, 'published', result.post_id);
    await incrementApiUsage(c.env.DB, account.id, 'article_publish').catch(() => {});
    return c.json({
      success: true,
      data: { article_id: xArticleDraftId, post_id: result.post_id },
    });
  } catch (err) {
    const message = errorMessage(err, 'Failed to publish article');
    return c.json(
      { success: false, error: message },
      err instanceof InlineImageError ? 400 : 500,
    );
  }
});

// POST /api/growth/articles/:id/discard — mark as discarded
growthArticles.post('/api/growth/articles/:id/discard', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  await setGrowthArticleStatus(c.env.DB, id, 'discarded');
  return c.json({ success: true });
});

export { growthArticles };
