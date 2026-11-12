import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { ArticleContentState } from '@x-harness/x-sdk';
import {
  collectInlineImageUrls,
  convertMarkdownToArticle,
  validateArticle,
  INLINE_GIF_CATEGORY,
  INLINE_IMAGE_CATEGORY,
  INLINE_VIDEO_CATEGORY,
  type InlineMedia,
} from '../services/article-markdown.js';
import { getXAccountById, incrementApiUsage } from '@x-harness/db';
import type { Env } from '../index.js';

const articles = new Hono<Env>();

// Rate-limit errors carry the window reset time — surface it so callers
// know when to retry instead of guessing.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof XApiRateLimitError && err.resetAtEpoch) {
    const resetJst = new Date(err.resetAtEpoch * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    return `Rate limited by X API（リセット: ${resetJst} JST）`;
  }
  return err instanceof Error ? err.message : fallback;
}


// Markdown → content_state conversion lives in services/article-markdown.ts
// (re-exported here for existing importers).
export {
  parseInlineStyles,
  parseInline,
  IMAGE_PARAGRAPH_RE,
  POST_PARAGRAPH_RE,
  collectInlineImageUrls,
  markdownToContentState,
  convertMarkdownToArticle,
  validateArticle,
} from '../services/article-markdown.js';
export type { InlineMedia } from '../services/article-markdown.js';

// A caller-input problem with an inline image (unfetchable URL, bad scheme).
export class InlineImageError extends Error {}

// Where uploadInlineImages reads image bytes from besides plain HTTP:
// growth images served by THIS worker must come from the R2 binding, because
// a Worker cannot fetch its own workers.dev hostname (self-fetch subrequests
// fail even though the URL is publicly reachable).
export interface InlineImageSource {
  workerUrl?: string;
  growthImages?: R2Bucket;
}

// Own-host growth image URL → R2 object key, or null for foreign URLs.
export function growthImageKey(url: string, workerUrl?: string): string | null {
  if (!workerUrl) return null;
  const prefix = `${workerUrl.replace(/\/$/, '')}/api/growth/img/`;
  return url.startsWith(prefix) ? `growth/${url.slice(prefix.length)}` : null;
}

async function loadArticleMedia(
  url: string,
  source: InlineImageSource,
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const r2Key = growthImageKey(url, source.workerUrl);
  if (r2Key && source.growthImages) {
    const obj = await source.growthImages.get(r2Key);
    if (!obj) throw new InlineImageError(`Article image not found in R2: ${url}`);
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType ?? 'image/png',
    };
  }
  if (!/^https:\/\//.test(url)) {
    throw new InlineImageError(`Article image URL must be https: ${url}`);
  }
  const parsed = new URL(url);
  if(parsed.username||parsed.password||parsed.hostname==='localhost'||parsed.hostname.endsWith('.local')||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(parsed.hostname)) throw new InlineImageError('Image host not allowed');
  const res = await fetch(url,{redirect: 'manual',signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new InlineImageError(`Failed to fetch article image (${res.status}): ${url}`);
  const contentType=(res.headers.get('content-type') ?? '').split(';')[0];
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(contentType)) throw new InlineImageError('Unsupported image content type');
  const limit=10*1024*1024;
  if(Number(res.headers.get('content-length'))>limit) throw new InlineImageError('Image exceeds 10MB');
  const reader=res.body?.getReader();if(!reader)throw new InlineImageError('Empty image');
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new InlineImageError('Image exceeds 10MB');}chunks.push(value);}
  const data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  return {data:data.buffer,contentType};
}

// Upload the Growth article's 5:2 header image as the X Article cover.
// Growth images are PNGs, and the Articles API requires tweet_image for
// cover_media (the category must match the upload).
export async function uploadArticleCover(
  url: string,
  xClient: XClient,
  source: InlineImageSource = {},
): Promise<string> {
  const { data, contentType } = await loadArticleMedia(url, source);
  if (!contentType.startsWith('image/') || contentType === 'image/gif') {
    throw new InlineImageError(`Article cover must be a non-GIF image: ${url}`);
  }
  return xClient.uploadMedia(data, contentType, 'tweet_image');
}

// Fetch every inline media URL referenced in the markdown body (same
// tokenizer as the converter, via collectInlineImageUrls) and upload it to
// X media, returning url → {media_id, media_category}. The category is
// picked from the actual content type: video/* → amplify_video (chunked
// upload + processing wait), image/gif → tweet_gif, anything else →
// tweet_image. Uploads run concurrently (media upload allows 500/15min).
// A failed image does NOT fail the article: it is left out of mediaMap (the
// converter then skips that block) and reported in warnings.
export async function uploadInlineImages(
  body: string,
  xClient: XClient,
  source: InlineImageSource = {},
): Promise<{ mediaMap: Record<string, InlineMedia>; warnings: string[]; failedUrls: string[] }> {
  const urls = collectInlineImageUrls(body);
  const settled = await Promise.allSettled(
    urls.map(async (url): Promise<InlineMedia> => {
      const { data, contentType } = await loadArticleMedia(url, source);
      if (contentType.startsWith('video/')) {
        const mediaId = await xClient.uploadVideo(data, contentType, INLINE_VIDEO_CATEGORY);
        return { media_id: mediaId, media_category: INLINE_VIDEO_CATEGORY };
      }
      const category = contentType === 'image/gif' ? INLINE_GIF_CATEGORY : INLINE_IMAGE_CATEGORY;
      return { media_id: await xClient.uploadMedia(data, contentType, category), media_category: category };
    }),
  );
  const mediaMap: Record<string, InlineMedia> = {};
  const warnings: string[] = [];
  const failedUrls: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      mediaMap[urls[i]] = r.value;
    } else {
      failedUrls.push(urls[i]);
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warnings.push(`画像のアップロードに失敗したためスキップしました: ${urls[i]}（${reason}）`);
    }
  });
  return { mediaMap, warnings, failedUrls };
}

// Markdown body → content_state with inline media uploaded, plus title /
// length validation. Images that fail are skipped with a warning (or, with
// strictImages, turned into errors); hard
// validation errors are returned so the caller can 400 BEFORE spending the
// 10/24h draft window (even 400s from X consume it).
export async function buildArticleContent(
  title: string,
  body: string,
  xClient: XClient,
  source: InlineImageSource = {},
  opts: { strictImages?: boolean } = {},
): Promise<{ contentState: ArticleContentState; warnings: string[]; errors: string[] }> {
  const upload = await uploadInlineImages(body, xClient, source);
  const converted = convertMarkdownToArticle(body, { mediaMap: upload.mediaMap, title });
  const validation = validateArticle(title, converted.contentState);
  // upload warnings already explain the skipped blocks — don't double-report
  const skipped = converted.warnings.filter((w) => !upload.failedUrls.some((u) => w.endsWith(`: ${u}`)));
  if (opts.strictImages && upload.warnings.length) {
    // one-shot draft+publish flows cannot show warnings before the article
    // goes live, so a missing image must stop them instead
    return {
      contentState: converted.contentState,
      warnings: validation.warnings,
      errors: [...upload.warnings, ...validation.errors],
    };
  }
  return {
    contentState: converted.contentState,
    warnings: [...upload.warnings, ...skipped, ...validation.warnings],
    errors: validation.errors,
  };
}

// POST /api/articles/draft — create a long-form Article draft
// Body: { xAccountId, title, body? (markdown-lite), contentState? (raw DraftJS), coverMediaId? }
articles.post('/api/articles/draft', async (c) => {
  const { xAccountId, title, body, contentState, coverMediaId } = await c.req.json<{
    xAccountId: string;
    title: string;
    body?: string;
    contentState?: ArticleContentState;
    coverMediaId?: string;
  }>();
  if (!xAccountId || !title) {
    return c.json({ success: false, error: 'Missing required fields: xAccountId, title' }, 400);
  }
  if (!body && !contentState) {
    return c.json({ success: false, error: 'Provide either body (markdown) or contentState (DraftJS)' }, 400);
  }

  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'articles');

  try {
    // Inline images are uploaded first — explicitly, not inline in the call —
    // and validation runs before the draft call, so a doomed request never
    // spends the 10/24h draft window. A failed image is skipped + warned.
    let content_state = contentState;
    let warnings: string[] = [];
    if (!content_state) {
      const built = await buildArticleContent(title, body!, xClient, {
        workerUrl: c.env.WORKER_URL,
        growthImages: c.env.GROWTH_IMAGES,
      });
      if (built.errors.length) {
        return c.json({ success: false, error: built.errors.join(' / '), warnings: built.warnings }, 400);
      }
      content_state = built.contentState;
      warnings = built.warnings;
    } else {
      const validation = validateArticle(title, content_state);
      if (validation.errors.length) {
        return c.json({ success: false, error: validation.errors.join(' / '), warnings: validation.warnings }, 400);
      }
      warnings = validation.warnings;
    }
    const draft = await xClient.createArticleDraft({
      title,
      content_state,
      // media_category is required by the Articles API and must match the
      // category the media was uploaded with (upload route defaults to tweet_image)
      ...(coverMediaId ? { cover_media: { media_id: coverMediaId, media_category: 'tweet_image' } } : {}),
    });
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'article_draft'));
    return c.json({ success: true, data: { ...draft, ...(warnings.length ? { warnings } : {}) } }, 201);
  } catch (err: any) {
    // A bad inline image is caller input, not a server fault.
    if (err instanceof InlineImageError) {
      return c.json({ success: false, error: err.message }, 400);
    }
    return c.json({ success: false, error: errorMessage(err, 'Failed to create article draft') }, 500);
  }
});

// POST /api/articles/:id/publish — publish a draft Article
articles.post('/api/articles/:id/publish', async (c) => {
  const articleId = c.req.param('id');
  const { xAccountId } = await c.req.json<{ xAccountId: string }>();
  if (!xAccountId) return c.json({ success: false, error: 'Missing required field: xAccountId' }, 400);

  const account = await getXAccountById(c.env.DB, xAccountId);
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'articles');

  try {
    const result = await xClient.publishArticle(articleId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'article_publish'));
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: errorMessage(err, 'Failed to publish article') }, 500);
  }
});

// GET /api/news/search?query=...&maxResults=10 — breaking news stories on X
articles.get('/api/news/search', async (c) => {
  const query = (c.req.query('query') ?? '').trim();
  const maxResults = Math.min(Number(c.req.query('maxResults') ?? '10') || 10, 50);
  const xAccountId = c.req.query('xAccountId');
  if (!query) return c.json({ success: false, error: 'Missing required parameter: query' }, 400);

  const account = xAccountId
    ? await getXAccountById(c.env.DB, xAccountId)
    : (await import('@x-harness/db').then((m) => m.getXAccounts(c.env.DB)))[0] ?? null;
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'articles');

  try {
    const result = await xClient.searchNews(query, maxResults);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'news_search'));
    return c.json({ success: true, data: result.data ?? [] });
  } catch (err: any) {
    return c.json({ success: false, error: errorMessage(err, 'Failed to search news') }, 500);
  }
});

// GET /api/news/:id — one news story with summary + related post cluster
articles.get('/api/news/:id', async (c) => {
  const newsId = c.req.param('id');
  const xAccountId = c.req.query('xAccountId');

  const account = xAccountId
    ? await getXAccountById(c.env.DB, xAccountId)
    : (await import('@x-harness/db').then((m) => m.getXAccounts(c.env.DB)))[0] ?? null;
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'articles');

  try {
    const story = await xClient.getNews(newsId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'news_get'));
    return c.json({ success: true, data: story });
  } catch (err: any) {
    return c.json({ success: false, error: errorMessage(err, 'Failed to fetch news story') }, 500);
  }
});

export { articles };
