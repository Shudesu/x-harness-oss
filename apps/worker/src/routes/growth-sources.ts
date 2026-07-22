import { Hono } from 'hono';
import {
  upsertSourceCandidate,
  getSourceCandidates,
  getSourceCandidate,
  setSourceCandidateStatus,
  createGrowthDraft,
} from '@x-harness/db';
import type { Env } from '../index.js';

const growthSources = new Hono<Env>();

// POST /api/growth/sources — ingest a discovered source candidate
growthSources.post('/api/growth/sources', async (c) => {
  const body = await c.req.json<{
    sourceTweetId?: string;
    author?: string;
    authorUrl?: string;
    textEn?: string;
    textJa?: string;
    summaryJa?: string;
    suggestedQuoteText?: string;
    videoUrl?: string;
    views?: number;
    likes?: number;
    theme?: string;
    transcript?: string;
  }>();
  const { sourceTweetId, author, textEn, textJa } = body;
  if (!sourceTweetId || !author || !textEn || !textJa) {
    return c.json(
      { success: false, error: 'Missing required fields: sourceTweetId, author, textEn, textJa' },
      400,
    );
  }
  const candidate = await upsertSourceCandidate(c.env.DB, {
    sourceTweetId,
    author,
    authorUrl: body.authorUrl,
    textEn,
    textJa,
    summaryJa: body.summaryJa,
    suggestedQuoteText: body.suggestedQuoteText,
    videoUrl: body.videoUrl,
    views: body.views ?? 0,
    likes: body.likes ?? 0,
    theme: body.theme,
    transcript: body.transcript,
  });
  return c.json({ success: true, data: candidate }, 201);
});

// GET /api/growth/sources — list candidates, optionally filtered by status
growthSources.get('/api/growth/sources', async (c) => {
  const status = c.req.query('status');
  const candidates = await getSourceCandidates(c.env.DB, { status });
  return c.json({ success: true, data: candidates });
});

// POST /api/growth/sources/:id/to-draft — convert candidate to a growth draft
growthSources.post('/api/growth/sources/:id/to-draft', async (c) => {
  const id = c.req.param('id');
  const candidate = await getSourceCandidate(c.env.DB, id);
  if (!candidate) return c.json({ success: false, error: 'Not found' }, 404);
  if (candidate.status !== 'new') {
    return c.json({ success: false, error: 'Candidate is not in new status' }, 409);
  }
  const body = await c.req.json<{
    xAccountId?: string;
    text?: string;
    scheduledAt?: string;
  }>();
  const { xAccountId, text, scheduledAt } = body;
  if (!xAccountId || !text || !scheduledAt) {
    return c.json(
      { success: false, error: 'Missing required fields: xAccountId, text, scheduledAt' },
      400,
    );
  }
  const draft = await createGrowthDraft(c.env.DB, {
    xAccountId,
    type: 'quote_rt',
    text,
    quoteTweetId: candidate.source_tweet_id,
    scheduledAt,
  });
  await setSourceCandidateStatus(c.env.DB, id, 'drafted');
  return c.json({ success: true, data: { draft, candidate } });
});

// POST /api/growth/sources/:id/dismiss — mark candidate as dismissed
growthSources.post('/api/growth/sources/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const candidate = await getSourceCandidate(c.env.DB, id);
  if (!candidate) return c.json({ success: false, error: 'Not found' }, 404);
  await setSourceCandidateStatus(c.env.DB, id, 'dismissed');
  return c.json({ success: true });
});

export { growthSources };
