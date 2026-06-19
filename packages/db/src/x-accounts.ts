import { jstNow } from './utils.js';

export interface DbXAccount {
  id: string;
  x_user_id: string;
  username: string;
  display_name: string | null;
  // 0618追加開始
  profile_image_url: string | null;
  // 0618追加終了
  access_token: string;
  refresh_token: string | null;
  consumer_key: string | null;
  consumer_secret: string | null;
  access_token_secret: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export async function createXAccount(
  db: D1Database,
  input: {
    xUserId: string;
    username: string;
    accessToken: string;
    refreshToken?: string;
    displayName?: string;
    // 0618追加開始
    profileImageUrl?: string;
    // 0618追加終了
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
  },
): Promise<DbXAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    // 0618修正開始
    .prepare(
      `INSERT INTO x_accounts (id, x_user_id, username, display_name, profile_image_url, access_token, refresh_token, consumer_key, consumer_secret, access_token_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    // 0618修正終了
    .bind(
      id,
      input.xUserId,
      input.username,
      //202606修正開始
      //input.displayName ?? null,
      input.displayName ?? input.username,
      input.profileImageUrl ?? null,
      //202606修正終了
      input.accessToken,
      input.refreshToken ?? null,
      input.consumerKey ?? null,
      input.consumerSecret ?? null,
      input.accessTokenSecret ?? null,
      now,
      now,
    )
    .first<DbXAccount>();
  return result!;
}

export async function getXAccounts(db: D1Database): Promise<DbXAccount[]> {
  const result = await db.prepare('SELECT * FROM x_accounts WHERE is_active = 1 ORDER BY created_at').all<DbXAccount>();
  return result.results;
}

export async function getXAccountById(db: D1Database, id: string): Promise<DbXAccount | null> {
  return db.prepare('SELECT * FROM x_accounts WHERE id = ?').bind(id).first<DbXAccount>();
}

export async function updateXAccount(
  db: D1Database,
  id: string,
  updates: {
    accessToken?: string;
    refreshToken?: string;
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
    isActive?: boolean;
  },
): Promise<void> {
  const now = jstNow();
  const existing = await getXAccountById(db, id);
  if (!existing) return;
  await db
    .prepare(
      `UPDATE x_accounts SET access_token = ?, refresh_token = ?, consumer_key = ?, consumer_secret = ?, access_token_secret = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      updates.accessToken ?? existing.access_token,
      updates.refreshToken ?? existing.refresh_token,
      updates.consumerKey ?? existing.consumer_key,
      updates.consumerSecret ?? existing.consumer_secret,
      updates.accessTokenSecret ?? existing.access_token_secret,
      updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();
}
// 202606追加開始
export async function updateXAccountProfile(
  db: D1Database,
  id: string,
  updates: {
    displayName?: string | null;
    profileImageUrl?: string | null;
    username?: string;
  },
): Promise<void> {
  const now = jstNow();

  await db
    .prepare(
      `UPDATE x_accounts
       SET display_name = ?,
           profile_image_url = ?,
           username = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      updates.displayName ?? null,
      updates.profileImageUrl ?? null,
      updates.username,
      now,
      id,
    )
    .run();
}
// 202606追加終了