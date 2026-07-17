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
// "1. " → ordered-list-item, everything else → unstyled paragraph.
// Links/images need DraftJS entities, which the Articles API docs don't
// fully specify yet — plain text only for now.
// The Articles API validates content_state strictly: blocks accept ONLY
// {text, type} — standard DraftJS raw fields (key/depth/inlineStyleRanges/
// entityRanges/data) are rejected with "additionalProperties" errors
// (verified against the live API, 2026-07-07).
function block(text: string, type: string): ArticleContentBlock {
  return { text, type };
}

export function markdownToContentState(body: string): ArticleContentState {
  const blocks: ArticleContentBlock[] = [];
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

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
