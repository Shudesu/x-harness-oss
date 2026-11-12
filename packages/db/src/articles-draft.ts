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
  x_article_draft_id: string | null;
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
  opts: { status?: string; xAccountId?: string } = {},
): Promise<DbGrowthArticle[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) {
    conditions.push('status = ?');
    binds.push(opts.status);
  }
  if (opts.xAccountId) {
    conditions.push('x_account_id = ?');
    binds.push(opts.xAccountId);
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

/**
 * Compare-and-set update: applies only while the row is still the snapshot
 * the caller read (same updated_at, still an editable draft). Returns false
 * when someone else changed it in the meantime.
 */
export async function updateGrowthArticleIfUnchanged(
  db: D1Database,
  id: string,
  expectedUpdatedAt: string,
  patch: { bodyMd?: string; imageUrl?: string },
): Promise<boolean> {
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [jstNow()];
  if (patch.bodyMd !== undefined) { sets.push('body_md = ?'); binds.push(patch.bodyMd); }
  if (patch.imageUrl !== undefined) { sets.push('image_url = ?'); binds.push(patch.imageUrl); }
  const res = await db
    .prepare(`UPDATE growth_articles SET ${sets.join(', ')} WHERE id = ? AND updated_at = ? AND status = 'draft' AND (x_article_draft_id IS NULL OR x_article_draft_id LIKE 'creating:%')`)
    .bind(...binds, id, expectedUpdatedAt)
    .run();
  return (res.meta?.changes ?? 0) > 0;
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

export async function setGrowthArticleXDraftId(
  db: D1Database,
  id: string,
  xArticleDraftId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE growth_articles SET x_article_draft_id = ?, updated_at = ? WHERE id = ?')
    .bind(xArticleDraftId, now, id)
    .run();
}

// Attach an X article draft that was created outside this worker (e.g. via
// MCP or the X UI). Only fills an empty slot so it can never overwrite a
// draft the harness itself created. Returns true when the row was updated.
export async function linkGrowthArticleXDraftId(
  db: D1Database,
  id: string,
  xArticleDraftId: string,
): Promise<boolean> {
  const now = jstNow();
  const res = await db
    .prepare("UPDATE growth_articles SET x_article_draft_id = ?, updated_at = ? WHERE id = ? AND status = 'draft' AND (x_article_draft_id IS NULL OR (x_article_draft_id LIKE 'creating:%' AND x_article_draft_id < ?))")
    .bind(xArticleDraftId, now, id, `${X_DRAFT_CLAIM_PREFIX}${new Date(Date.now() - X_DRAFT_CLAIM_TTL_MS).toISOString()}`)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// X draft creation is claimed in D1 before calling X so two overlapping
// requests cannot both create a draft (X allows 10 per 24h). The claim value
// is `creating:<ISO time>`; a claim older than 10 minutes (crashed request)
// may be taken over. Returns the claim token, or null if already taken.
export const X_DRAFT_CLAIM_PREFIX = 'creating:';
export function isXDraftClaim(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(X_DRAFT_CLAIM_PREFIX);
}
const X_DRAFT_CLAIM_TTL_MS = 10 * 60 * 1000;
/** A claim younger than 10 minutes: another request may still be creating the draft. */
export function isActiveXDraftClaim(value: string | null | undefined, now = new Date()): boolean {
  if (!isXDraftClaim(value)) return false;
  const at = Date.parse((value as string).slice(X_DRAFT_CLAIM_PREFIX.length));
  return Number.isNaN(at) || now.getTime() - at < X_DRAFT_CLAIM_TTL_MS;
}
export async function claimGrowthArticleXDraft(db: D1Database, id: string, now = new Date()): Promise<string | null> {
  const token = `${X_DRAFT_CLAIM_PREFIX}${now.toISOString()}`;
  const stale = `${X_DRAFT_CLAIM_PREFIX}${new Date(now.getTime() - X_DRAFT_CLAIM_TTL_MS).toISOString()}`;
  const res = await db
    .prepare("UPDATE growth_articles SET x_article_draft_id = ? WHERE id = ? AND status = 'draft' AND (x_article_draft_id IS NULL OR (x_article_draft_id LIKE 'creating:%' AND x_article_draft_id < ?))")
    .bind(token, id, stale)
    .run();
  return (res.meta?.changes ?? 0) > 0 ? token : null;
}
export async function settleGrowthArticleXDraftClaim(db: D1Database, id: string, token: string, xArticleDraftId: string | null): Promise<void> {
  await db
    .prepare('UPDATE growth_articles SET x_article_draft_id = ?, updated_at = ? WHERE id = ? AND x_article_draft_id = ?')
    .bind(xArticleDraftId, jstNow(), id, token)
    .run();
}
