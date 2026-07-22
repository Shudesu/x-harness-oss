import { Hono } from 'hono';
import {
  createGrowthArticle,
  getGrowthArticles,
  getGrowthArticle,
  updateGrowthArticle,
  setGrowthArticleStatus,
} from '@x-harness/db';
import type { Env } from '../index.js';

const growthArticles = new Hono<Env>();

// POST /api/growth/articles/image — store a header image in R2, return its public URL.
// Auth is handled by the global Bearer middleware. The served URL below is public
// (keyed by an unguessable UUID) so <img> tags on the dashboard can load it.
growthArticles.post('/api/growth/articles/image', async (c) => {
  if (!c.env.GROWTH_IMAGES) return c.json({ success: false, error: 'R2 not configured' }, 500);
  const form = await c.req.formData();
  const file = form.get('file') as unknown;
  if (!(file instanceof File)) return c.json({ success: false, error: 'file is required' }, 400);
  const base = (c.env.WORKER_URL || '').replace(/\/$/, '');
  if (!base) return c.json({ success: false, error: 'WORKER_URL not configured' }, 500);
  // Pipeline always uploads PNG (codex imagegen output); store as .png with matching type.
  const key = `growth/${crypto.randomUUID()}.png`;
  await c.env.GROWTH_IMAGES.put(key, await file.arrayBuffer(), {
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

// POST /api/growth/articles/:id/publish — mark as published
growthArticles.post('/api/growth/articles/:id/publish', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  if (article.status !== 'draft') {
    return c.json({ success: false, error: 'Article is not a draft' }, 409);
  }
  const body = await c.req.json<{ publishedArticleId?: string }>();
  await setGrowthArticleStatus(c.env.DB, id, 'published', body.publishedArticleId);
  return c.json({ success: true });
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
