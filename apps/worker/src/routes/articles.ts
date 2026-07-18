import { Hono } from 'hono';
import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { ArticleContentState, ArticleContentBlock, ArticleEntity } from '@x-harness/x-sdk';
import { getXAccountById, incrementApiUsage } from '@x-harness/db';
import type { Env } from '../index.js';

const articles = new Hono<Env>();

// Rate-limit errors carry the window reset time — surface it so callers
// know when to retry instead of guessing.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof XApiRateLimitError && err.resetAtEpoch) {
    const resetJst = new Date(err.resetAtEpoch * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    return `Rate limited by X API（リセット: ${resetJst} JST）`;
  }
  return err instanceof Error ? err.message : fallback;
}

function buildXClient(account: { consumer_key: string | null; consumer_secret: string | null; access_token: string; access_token_secret: string | null }): XClient {
  return account.consumer_key && account.consumer_secret && account.access_token_secret
    ? new XClient({
        type: 'oauth1',
        consumerKey: account.consumer_key,
        consumerSecret: account.consumer_secret,
        accessToken: account.access_token,
        accessTokenSecret: account.access_token_secret,
      })
    : new XClient(account.access_token);
}

// Convert markdown-lite body text into DraftJS-style content blocks.
// Supported per line-group: "# " → header-one, "## " → header-two,
// "> " → blockquote, "- "/"* " → unordered-list-item (one block per line),
// "1. " → ordered-list-item, ``` fences → plain paragraph (the article
// editor has no code-block type), "![alt](url)" on its own paragraph →
// atomic block + image entity (url must resolve via mediaMap),
// everything else → unstyled paragraph.
// Inline: **bold** → inline_style_ranges style "bold" (write-side enum is
// lowercase [bold, italic, strikethrough] — the editor's read side shows
// "Bold" but the API rejects it; verified live 2026-07-18), `code` →
// backticks stripped (no code style exists).
// The Articles API validates content_state strictly and wants snake_case
// range fields: entity_ranges is accepted (verified live 2026-07-17);
// camelCase DraftJS names are rejected as additionalProperties. The same
// applies inside entity data: media_items/media_id/media_category — the
// read-side camelCase (mediaItems/mediaId) is rejected on write.

// Strip inline markdown markers and emit Bold ranges. Offsets/lengths are
// UTF-16 code units (JS string indexing), which is how the editor counts.
export function parseInlineStyles(raw: string): {
  text: string;
  ranges: { offset: number; length: number; style: string }[];
} {
  const ranges: { offset: number; length: number; style: string }[] = [];
  let text = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('**', i)) {
      const end = raw.indexOf('**', i + 2);
      if (end > i + 2) {
        const inner = raw.slice(i + 2, end).replace(/`/g, '');
        ranges.push({ offset: text.length, length: inner.length, style: 'bold' });
        text += inner;
        i = end + 2;
        continue;
      }
    }
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end !== -1) {
        text += raw.slice(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    text += raw[i];
    i++;
  }
  return { text, ranges };
}

function block(raw: string, type: string): ArticleContentBlock {
  const { text, ranges } = parseInlineStyles(raw);
  return { text, type, ...(ranges.length ? { inline_style_ranges: ranges } : {}) };
}

// Standalone-image paragraph: ![alt](url) alone in its own paragraph.
// The URL is captured greedily to the final ')' so URLs containing parens
// (e.g. .../img_(1).png) still match; \S+ keeps it a single token.
export const IMAGE_PARAGRAPH_RE = /^!\[([^\]]*)\]\((\S+)\)$/;

// Inline images are uploaded and referenced with the same category — the
// draft validator rejects mismatches, so both sides share this constant.
const INLINE_IMAGE_CATEGORY = 'tweet_image';

// A caller-input problem with an inline image (unfetchable URL, bad scheme).
// The route maps this to 400 — it is not a server fault.
export class InlineImageError extends Error {}

// Shared tokenization for the converter and the image collector: ``` fences
// are pulled out first (their content must not be paragraph-split, inline-
// parsed, or image-scanned), then the rest splits on blank lines. Both
// consumers seeing the same paragraphs guarantees the uploaded image set
// and the converted image set always agree.
function segmentBody(body: string): { fences: string[]; paragraphs: string[] } {
  const fences: string[] = [];
  const normalized = body.replace(/\r\n/g, '\n').replace(
    /```[^\n]*\n?([\s\S]*?)```/g,
    (_m, code: string) => `\n\n\u0000FENCE${fences.push(code.replace(/\n+$/, '')) - 1}\u0000\n\n`,
  );
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { fences, paragraphs };
}

// Every image URL the converter will turn into an entity — same segmentation.
export function collectInlineImageUrls(body: string): string[] {
  const urls = new Set<string>();
  for (const para of segmentBody(body).paragraphs) {
    const m = para.match(IMAGE_PARAGRAPH_RE);
    if (m) urls.add(m[2]);
  }
  return [...urls];
}

// mediaMap: image URL (as written in the markdown) → uploaded X media_id.
// title: when given, a leading "# <title>" heading is dropped — the Articles
// API renders the draft title separately, so keeping it duplicates the H1.
export function markdownToContentState(
  body: string,
  mediaMap: Record<string, string> = {},
  title?: string,
): ArticleContentState {
  const blocks: ArticleContentBlock[] = [];
  const entities: ArticleEntity[] = [];
  const { fences, paragraphs } = segmentBody(body);

  for (const [index, trimmed] of paragraphs.entries()) {
    const fenceMatch = trimmed.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      const code = fences[Number(fenceMatch[1])];
      if (code.trim()) blocks.push({ text: code, type: 'unstyled' });
      continue;
    }

    const imageMatch = trimmed.match(IMAGE_PARAGRAPH_RE);
    if (imageMatch) {
      const [, alt, url] = imageMatch;
      const mediaId = mediaMap[url];
      if (!mediaId) {
        throw new InlineImageError(`No uploaded media for inline image: ${url}`);
      }
      const key = entities.length;
      entities.push({
        key: String(key),
        value: {
          type: 'image',
          mutability: 'immutable',
          data: {
            ...(alt ? { caption: alt } : {}),
            media_items: [{ media_id: mediaId, media_category: INLINE_IMAGE_CATEGORY }],
          },
        },
      });
      blocks.push({ text: ' ', type: 'atomic', entity_ranges: [{ offset: 0, length: 1, key }] });
      continue;
    }

    // Only the very first paragraph of the source can be the duplicated
    // title (index-based — an image/fence opening the body must not hide a
    // later duplicate H1 from this check by bumping blocks.length).
    if (title && index === 0 && trimmed.startsWith('# ') && trimmed.slice(2).trim() === title.trim()) {
      continue;
    }

    const lines = trimmed.split('\n');
    const isList = lines.every((l) => /^(-|\*|\d+\.)\s+/.test(l.trim()));
    if (isList && lines.length > 0) {
      for (const line of lines) {
        const t = line.trim();
        const ordered = /^\d+\.\s+/.test(t);
        blocks.push(block(t.replace(/^(-|\*|\d+\.)\s+/, ''), ordered ? 'ordered-list-item' : 'unordered-list-item'));
      }
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push(block(trimmed.slice(3).trim(), 'header-two'));
    } else if (trimmed.startsWith('# ')) {
      blocks.push(block(trimmed.slice(2).trim(), 'header-one'));
    } else if (trimmed.startsWith('> ')) {
      blocks.push(block(lines.map((l) => l.replace(/^>\s?/, '')).join('\n'), 'blockquote'));
    } else {
      blocks.push(block(lines.join('\n'), 'unstyled'));
    }
  }

  return { blocks, entities };
}

// Fetch every inline image referenced in the markdown body (same paragraph
// segmentation as markdownToContentState, via collectInlineImageUrls) and
// upload it to X media, returning url → media_id. Uploads run concurrently
// (media upload allows 500/15min). Throws InlineImageError on any failed
// fetch/upload so a broken image is caught BEFORE the draft call spends
// 24h-window quota (draft creation is capped at 10/24h and even 400s
// consume it).
export async function uploadInlineImages(
  body: string,
  xClient: XClient,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    collectInlineImageUrls(body).map(async (url): Promise<[string, string]> => {
      if (!/^https:\/\//.test(url)) {
        throw new InlineImageError(`Inline image URL must be https: ${url}`);
      }
      const res = await fetch(url);
      if (!res.ok) throw new InlineImageError(`Failed to fetch inline image (${res.status}): ${url}`);
      const contentType = res.headers.get('content-type') ?? 'image/png';
      return [url, await xClient.uploadMedia(await res.arrayBuffer(), contentType, INLINE_IMAGE_CATEGORY)];
    }),
  );
  return Object.fromEntries(entries);
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
  const xClient = buildXClient(account);

  try {
    // Inline images are uploaded first — explicitly, not inline in the call —
    // so any failure aborts before the draft call and the 10/24h draft
    // window is never spent on a doomed request.
    let content_state = contentState;
    if (!content_state) {
      const mediaMap = await uploadInlineImages(body!, xClient);
      content_state = markdownToContentState(body!, mediaMap, title);
    }
    const draft = await xClient.createArticleDraft({
      title,
      content_state,
      // media_category is required by the Articles API and must match the
      // category the media was uploaded with (upload route defaults to tweet_image)
      ...(coverMediaId ? { cover_media: { media_id: coverMediaId, media_category: 'tweet_image' } } : {}),
    });
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'article_draft'));
    return c.json({ success: true, data: draft }, 201);
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
  const xClient = buildXClient(account);

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
  const xClient = buildXClient(account);

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
  const xClient = buildXClient(account);

  try {
    const story = await xClient.getNews(newsId);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'news_get'));
    return c.json({ success: true, data: story });
  } catch (err: any) {
    return c.json({ success: false, error: errorMessage(err, 'Failed to fetch news story') }, 500);
  }
});

export { articles };
