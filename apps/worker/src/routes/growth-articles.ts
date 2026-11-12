import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import {
  createGrowthArticle,
  getGrowthArticles,
  getGrowthArticle,
  getXAccountById,
  incrementApiUsage,
  updateGrowthArticle,
  updateGrowthArticleIfUnchanged,
  setGrowthArticleXDraftId,
  setGrowthArticleStatus,
  linkGrowthArticleXDraftId,
  claimGrowthArticleXDraft,
  settleGrowthArticleXDraftClaim,
  isXDraftClaim,
  isActiveXDraftClaim,
} from '@x-harness/db';
import type { DbGrowthArticle } from '@x-harness/db';
import {
  InlineImageError,
  buildArticleContent,
  errorMessage,
  uploadArticleCover,
} from './articles.js';
import type { Env } from '../index.js';
import { importArticleImages, imageExtension, storeHarnessImage, type ImageImportResult } from '../services/article-images.js';

const growthArticles = new Hono<Env>();

function imageImportFor(env: Env['Bindings']) {
  return { workerUrl: env.WORKER_URL, bucket: env.GROWTH_IMAGES };
}

function importSummary(r: ImageImportResult) {
  return { imported: r.imported.length, failed: r.failed };
}

// X article drafts are immutable from our side once created, and X caps draft
// creation at 10 per 24h (even failed calls count), so the slot is recorded
// immediately after creation. Inline images are strict: a failed image aborts
// before the draft call (the saved draft would otherwise hide the missing image
// on later publishes). Non-fatal conversion notes come back as warnings.
async function createXDraftForArticle(
  env: Env['Bindings'],
  article: DbGrowthArticle,
): Promise<{ draftId: string; warnings: string[] }> {
  const account = await getXAccountById(env.DB, article.x_account_id);
  if (!account) throw new NotFoundError('X account not found');
  const xClient = await buildXClient(env, account, 'growth-articles');
  const claim = await claimGrowthArticleXDraft(env.DB, article.id);
  if (!claim) throw new ConflictError('X draft is already being created or linked; reload and retry');
  let draftId: string | null = null;
  let warnings: string[] = [];
  try {
    const source = { workerUrl: env.WORKER_URL, growthImages: env.GROWTH_IMAGES };
    const [built, coverMediaId] = await Promise.all([
      buildArticleContent(article.title, article.body_md, xClient, source, { strictImages: true }),
      article.image_url ? uploadArticleCover(article.image_url, xClient, source) : Promise.resolve(undefined),
    ]);
    warnings = built.warnings;
    if (built.errors.length) throw new ContentError(built.errors.join(' / '), built.warnings);
    const draft = await xClient.createArticleDraft({
      title: article.title,
      content_state: built.contentState,
      ...(coverMediaId
        ? { cover_media: { media_id: coverMediaId, media_category: 'tweet_image' } }
        : {}),
    });
    draftId = draft.id;
  } finally {
    // Success records the id; failure releases the claim for a retry.
    await settleGrowthArticleXDraftClaim(env.DB, article.id, claim, draftId);
  }
  // Usage logging must never turn a successful X mutation into a failed
  // response (which could tempt the caller to create a duplicate draft).
  await incrementApiUsage(env.DB, account.id, 'article_draft').catch(() => {});
  return { draftId, warnings };
}

class ContentError extends Error {
  constructor(message: string, readonly warnings: string[]) { super(message); }
}
class NotFoundError extends Error {}
class ConflictError extends Error {}

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
  // Keep the real raster type (png/jpeg/gif/webp); the pipeline's untyped
  // uploads default to PNG as before. SVG is refused (served publicly).
  const raw = (file as Blob).type;
  const declared = !raw || raw === 'application/octet-stream' ? 'image/png' : raw;
  if (!imageExtension(declared)) return c.json({ success: false, error: `Unsupported image type: ${declared}` }, 400);
  const url = await storeHarnessImage(c.env.GROWTH_IMAGES, base, await (file as Blob).arrayBuffer(), declared);
  return c.json({ success: true, data: { url } }, 201);
});

// GET /api/growth/img/:name — public image serve from R2 (no auth; UUID key is the secret)
growthArticles.get('/api/growth/img/:name', async (c) => {
  if (!c.env.GROWTH_IMAGES) return c.notFound();
  const obj = await c.env.GROWTH_IMAGES.get(`growth/${c.req.param('name')}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
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
  if (typeof xAccountId !== 'string' || !xAccountId.trim() || typeof title !== 'string' || !title.trim() || typeof bodyMd !== 'string' || !bodyMd.trim()) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, title, bodyMd' }, 400);
  }
  if ((imageUrl !== undefined && typeof imageUrl !== 'string') || (theme !== undefined && typeof theme !== 'string') || (sourceTweetIds !== undefined && (!Array.isArray(sourceTweetIds) || sourceTweetIds.some(id => typeof id !== 'string')))) {
    return c.json({ success: false, error: 'Invalid optional article fields' }, 400);
  }
  if (!await getXAccountById(c.env.DB, xAccountId)) {
    return c.json({ success: false, error: 'X account not found' }, 404);
  }
  // External images (Drive links etc.) are copied into harness storage so the
  // dashboard and X draft creation never depend on a third-party host.
  const images = await importArticleImages({ imageUrl, bodyMd }, imageImportFor(c.env));
  const article = await createGrowthArticle(c.env.DB, {
    xAccountId,
    title,
    bodyMd: images.bodyMd ?? bodyMd,
    imageUrl: images.imageUrl,
    theme,
    sourceTweetIds: Array.isArray(sourceTweetIds) ? JSON.stringify(sourceTweetIds) : sourceTweetIds,
  });
  return c.json({ success: true, data: article, imageImport: importSummary(images) }, 201);
});

// GET /api/growth/articles — list articles with optional status filter
growthArticles.get('/api/growth/articles', async (c) => {
  const status = c.req.query('status');
  const xAccountId = c.req.query('xAccountId');
  const articles = await getGrowthArticles(c.env.DB, { status, ...(xAccountId ? { xAccountId } : {}) });
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
  // An expired creation claim (crashed request) does not freeze the content.
  if (article.x_article_draft_id && (!isXDraftClaim(article.x_article_draft_id) || isActiveXDraftClaim(article.x_article_draft_id))) {
    return c.json({ success: false, error: 'X draft already created; create a new article to change its content' }, 409);
  }
  const body = await c.req.json<{ title?: string; bodyMd?: string; imageUrl?: string }>();
  if ((body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) ||
      (body.bodyMd !== undefined && (typeof body.bodyMd !== 'string' || !body.bodyMd.trim())) ||
      (body.imageUrl !== undefined && typeof body.imageUrl !== 'string')) {
    return c.json({ success: false, error: 'Invalid article fields' }, 400);
  }
  const images = await importArticleImages({ imageUrl: body.imageUrl, bodyMd: body.bodyMd }, imageImportFor(c.env));
  await updateGrowthArticle(c.env.DB, id, { title: body.title, bodyMd: images.bodyMd, imageUrl: images.imageUrl });
  const updated = await getGrowthArticle(c.env.DB, id);
  return c.json({ success: true, data: updated, imageImport: importSummary(images) });
});

// POST /api/growth/articles/:id/import-images — copy the stored cover + body
// images of an existing draft into harness storage (for articles saved before
// automatic import existed, or whose earlier import failed).
growthArticles.post('/api/growth/articles/:id/import-images', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  const frozen = article.x_article_draft_id && (!isXDraftClaim(article.x_article_draft_id) || isActiveXDraftClaim(article.x_article_draft_id));
  if (article.status !== 'draft' || frozen) {
    return c.json({ success: false, error: 'X draft already created or article not a draft; images are frozen' }, 409);
  }
  const images = await importArticleImages(
    { imageUrl: article.image_url ?? undefined, bodyMd: article.body_md },
    imageImportFor(c.env),
  );
  if (images.imported.length > 0) {
    // Downloads take a while: never overwrite an edit saved in the meantime.
    const applied = await updateGrowthArticleIfUnchanged(c.env.DB, id, article.updated_at, {
      ...(images.bodyMd !== article.body_md ? { bodyMd: images.bodyMd } : {}),
      ...(images.imageUrl !== (article.image_url ?? undefined) ? { imageUrl: images.imageUrl } : {}),
    });
    if (!applied) {
      return c.json({ success: false, error: 'Article changed while importing images; reload and retry' }, 409);
    }
  }
  const updated = await getGrowthArticle(c.env.DB, id);
  return c.json({ success: true, data: updated, imageImport: importSummary(images) });
});

// POST /api/growth/articles/:id/x-draft — create the X Article draft only
// (no publish). Idempotent: an existing draft id is returned as-is.
growthArticles.post('/api/growth/articles/:id/x-draft', async (c) => {
  const id = c.req.param('id');
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  if (article.status !== 'draft') return c.json({ success: false, error: 'Article is not a draft' }, 409);
  if (isActiveXDraftClaim(article.x_article_draft_id)) {
    return c.json({ success: false, error: 'X draft creation is already in progress' }, 409);
  }
  // An expired claim (crashed request) is taken over by createXDraftForArticle.
  // If that request did create a draft on X, link it with PUT instead.
  if (article.x_article_draft_id && !isXDraftClaim(article.x_article_draft_id)) {
    return c.json({ success: true, data: { x_article_draft_id: article.x_article_draft_id, created: false } });
  }
  try {
    const { draftId, warnings } = await createXDraftForArticle(c.env, article);
    return c.json({
      success: true,
      data: { x_article_draft_id: draftId, created: true, ...(warnings.length ? { warnings } : {}) },
    }, 201);
  } catch (err) {
    if (err instanceof ContentError) return c.json({ success: false, error: err.message, warnings: err.warnings }, 400);
    if (err instanceof NotFoundError) return c.json({ success: false, error: err.message }, 404);
    if (err instanceof ConflictError) return c.json({ success: false, error: err.message }, 409);
    return c.json(
      { success: false, error: errorMessage(err, 'Failed to create X article draft') },
      err instanceof InlineImageError ? 400 : 500,
    );
  }
});

// PUT /api/growth/articles/:id/x-draft — link an X draft that was created
// elsewhere (MCP / X UI). Only fills an empty slot.
growthArticles.put('/api/growth/articles/:id/x-draft', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ xArticleDraftId?: unknown }>().catch(() => ({} as { xArticleDraftId?: unknown }));
  const draftId = typeof body.xArticleDraftId === 'string' ? body.xArticleDraftId.trim() : '';
  if (!/^\d{1,25}$/.test(draftId)) {
    return c.json({ success: false, error: 'xArticleDraftId must be a numeric X draft id' }, 400);
  }
  const article = await getGrowthArticle(c.env.DB, id);
  if (!article) return c.json({ success: false, error: 'Not found' }, 404);
  if (article.x_article_draft_id === draftId) return c.json({ success: true, data: article });
  if (article.status !== 'draft') return c.json({ success: false, error: 'Article is not a draft' }, 409);
  if (isActiveXDraftClaim(article.x_article_draft_id)) {
    return c.json({ success: false, error: 'X draft creation is in progress; retry in a few minutes' }, 409);
  }
  if (article.x_article_draft_id && !isXDraftClaim(article.x_article_draft_id)) {
    return c.json({ success: false, error: 'Another X draft is already linked' }, 409);
  }
  if (!await linkGrowthArticleXDraftId(c.env.DB, id, draftId)) {
    return c.json({ success: false, error: 'Article changed concurrently; reload and retry' }, 409);
  }
  return c.json({ success: true, data: await getGrowthArticle(c.env.DB, id) });
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

  if (isActiveXDraftClaim(article.x_article_draft_id)) {
    return c.json({ success: false, error: 'X draft creation is already in progress' }, 409);
  }
  const account = await getXAccountById(c.env.DB, article.x_account_id);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'growth-articles');

  let warnings: string[] = [];
  try {
    // An expired claim is not a draft id: create (taking the claim over).
    let xArticleDraftId = isXDraftClaim(article.x_article_draft_id) ? null : article.x_article_draft_id;
    if (!xArticleDraftId) {
      const created = await createXDraftForArticle(c.env, article);
      xArticleDraftId = created.draftId;
      warnings = created.warnings;
    }

    const result = await xClient.publishArticle(xArticleDraftId);
    await setGrowthArticleStatus(c.env.DB, id, 'published', result.post_id);
    await incrementApiUsage(c.env.DB, account.id, 'article_publish').catch(() => {});
    return c.json({
      success: true,
      data: { article_id: xArticleDraftId, post_id: result.post_id, ...(warnings.length ? { warnings } : {}) },
    });
  } catch (err) {
    if (err instanceof ContentError) return c.json({ success: false, error: err.message, warnings: err.warnings }, 400);
    if (err instanceof NotFoundError) return c.json({ success: false, error: err.message }, 404);
    if (err instanceof ConflictError) return c.json({ success: false, error: err.message }, 409);
    const message = errorMessage(err, 'Failed to publish article');
    // a draft may already have been created with skipped images — surface
    // that so the caller knows before retrying the saved draft
    return c.json(
      { success: false, error: message, ...(warnings.length ? { warnings } : {}) },
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
