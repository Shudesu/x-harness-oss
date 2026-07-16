import { jstNow } from './utils.js';

export interface DbSourceCandidate {
  id: string;
  source_tweet_id: string;
  author: string;
  author_url: string | null;
  text_en: string;
  text_ja: string;
  summary_ja: string | null;
  suggested_quote_text: string | null;
  video_url: string | null;
  views: number;
  likes: number;
  theme: string | null;
  transcript: string | null;
  status: string;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

export async function upsertSourceCandidate(
  db: D1Database,
  c: {
    sourceTweetId: string;
    author: string;
    authorUrl?: string;
    textEn: string;
    textJa: string;
    summaryJa?: string;
    suggestedQuoteText?: string;
    videoUrl?: string;
    views: number;
    likes: number;
    theme?: string;
    transcript?: string;
  },
): Promise<DbSourceCandidate> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT INTO source_candidates
        (id, source_tweet_id, author, author_url, text_en, text_ja, summary_ja, suggested_quote_text, video_url, views, likes, theme, transcript, status, discovered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
       ON CONFLICT(source_tweet_id) DO UPDATE SET
         author = excluded.author,
         author_url = excluded.author_url,
         text_en = excluded.text_en,
         text_ja = excluded.text_ja,
         summary_ja = excluded.summary_ja,
         suggested_quote_text = excluded.suggested_quote_text,
         video_url = excluded.video_url,
         views = excluded.views,
         likes = excluded.likes,
         theme = excluded.theme,
         transcript = excluded.transcript,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .bind(
      id,
      c.sourceTweetId,
      c.author,
      c.authorUrl ?? null,
      c.textEn,
      c.textJa,
      c.summaryJa ?? null,
      c.suggestedQuoteText ?? null,
      c.videoUrl ?? null,
      c.views,
      c.likes,
      c.theme ?? null,
      c.transcript ?? null,
      now,
      now,
      now,
    )
    .first<DbSourceCandidate>();
  return result!;
}

export async function getSourceCandidates(
  db: D1Database,
  opts: { status?: string } = {},
): Promise<DbSourceCandidate[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) {
    conditions.push('status = ?');
    binds.push(opts.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM source_candidates ${where} ORDER BY views DESC`)
    .bind(...binds)
    .all<DbSourceCandidate>();
  return result.results;
}

export async function getSourceCandidate(db: D1Database, id: string): Promise<DbSourceCandidate | null> {
  const result = await db
    .prepare('SELECT * FROM source_candidates WHERE id = ?')
    .bind(id)
    .first<DbSourceCandidate>();
  return result ?? null;
}

export async function setSourceCandidateStatus(
  db: D1Database,
  id: string,
  status: 'new' | 'drafted' | 'dismissed',
): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE source_candidates SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run();
}
