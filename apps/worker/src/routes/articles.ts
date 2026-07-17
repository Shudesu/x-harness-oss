import { Hono } from 'hono';
import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { ArticleContentState, ArticleContentBlock } from '@x-harness/x-sdk';
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
// editor has no code-block type), everything else → unstyled paragraph.
// Inline: **bold** → inline_style_ranges style "Bold" (the style name the
// article editor stores — verified via a live article's entityMap),
// `code` → backticks stripped (no code style exists).
// The Articles API validates content_state strictly and wants snake_case
// range fields: entity_ranges is accepted (verified live 2026-07-17);
// camelCase DraftJS names are rejected as additionalProperties.

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
        ranges.push({ offset: text.length, length: inner.length, style: 'Bold' });
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

export function markdownToContentState(body: string): ArticleContentState {
  const blocks: ArticleContentBlock[] = [];
  // Pull ``` fences out first — fence content must not be paragraph-split or
  // inline-parsed. Each fence becomes one plain paragraph (newlines kept).
  const fences: string[] = [];
  const normalized = body.replace(/\r\n/g, '\n').replace(
    /```[^\n]*\n?([\s\S]*?)```/g,
    (_m, code: string) => `\n\n\u0000FENCE${fences.push(code.replace(/\n+$/, '')) - 1}\u0000\n\n`,
  );
  const paragraphs = normalized.split(/\n{2,}/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const fenceMatch = trimmed.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      const code = fences[Number(fenceMatch[1])];
      if (code.trim()) blocks.push({ text: code, type: 'unstyled' });
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

  return { blocks, entities: [] };
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
    const draft = await xClient.createArticleDraft({
      title,
      content_state: contentState ?? markdownToContentState(body!),
      // media_category is required by the Articles API and must match the
      // category the media was uploaded with (upload route defaults to tweet_image)
      ...(coverMediaId ? { cover_media: { media_id: coverMediaId, media_category: 'tweet_image' } } : {}),
    });
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'article_draft'));
    return c.json({ success: true, data: draft }, 201);
  } catch (err: any) {
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
