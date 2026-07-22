import { jstNow } from './utils.js';

export interface DbGrowthArticle {
  id: string;
  x_account_id: string;
  title: string;
  body_md: string;
  image_url: string | null;
  theme: string | null;
  source_tweet_ids: string | null;
  status: string;
  published_article_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createGrowthArticle(
  db: D1Database,
  a: {
    xAccountId: string;
    title: string;
    bodyMd: string;
    imageUrl?: string;
    theme?: string;
    sourceTweetIds?: string;
  },
): Promise<DbGrowthArticle> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      'INSERT INTO growth_articles (id, x_account_id, title, body_md, image_url, theme, source_tweet_ids, status, published_article_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(
      id,
      a.xAccountId,
      a.title,
      a.bodyMd,
      a.imageUrl ?? null,
      a.theme ?? null,
      a.sourceTweetIds ?? null,
      'draft',
      null,
      now,
      now,
    )
    .first<DbGrowthArticle>();
  return result!;
}

export async function getGrowthArticles(
  db: D1Database,
  opts: { status?: string } = {},
): Promise<DbGrowthArticle[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) {
    conditions.push('status = ?');
    binds.push(opts.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM growth_articles ${where} ORDER BY created_at DESC`)
    .bind(...binds)
    .all<DbGrowthArticle>();
  return result.results;
}

export async function getGrowthArticle(db: D1Database, id: string): Promise<DbGrowthArticle | null> {
  const result = await db
    .prepare('SELECT * FROM growth_articles WHERE id = ?')
    .bind(id)
    .first<DbGrowthArticle>();
  return result ?? null;
}

export async function updateGrowthArticle(
  db: D1Database,
  id: string,
  patch: { title?: string; bodyMd?: string; imageUrl?: string },
): Promise<void> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now];
  if (patch.title !== undefined) { sets.push('title = ?'); binds.push(patch.title); }
  if (patch.bodyMd !== undefined) { sets.push('body_md = ?'); binds.push(patch.bodyMd); }
  if (patch.imageUrl !== undefined) { sets.push('image_url = ?'); binds.push(patch.imageUrl); }
  await db
    .prepare(`UPDATE growth_articles SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
}

export async function setGrowthArticleStatus(
  db: D1Database,
  id: string,
  status: string,
  publishedArticleId?: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE growth_articles SET status = ?, published_article_id = ?, updated_at = ? WHERE id = ?')
    .bind(status, publishedArticleId ?? null, now, id)
    .run();
}
