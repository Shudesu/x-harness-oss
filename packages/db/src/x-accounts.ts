import { jstNow } from './utils.js';

export interface DbXAccount {
  id: string;
  x_user_id: string;
  username: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  consumer_key: string | null;
  consumer_secret: string | null;
  access_token_secret: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface XAccountAuditInput {
  actor: 'human' | 'hermes' | 'system' | 'codex';
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  correlationId: string;
}

export async function createXAccount(
  db: D1Database,
  input: {
    xUserId: string;
    username: string;
    accessToken: string;
    refreshToken?: string;
    displayName?: string;
    consumerKey?: string;
    consumerSecret?: string;
    accessTokenSecret?: string;
  },
): Promise<DbXAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT INTO x_accounts (id, x_user_id, username, display_name, access_token, refresh_token, consumer_key, consumer_secret, access_token_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      id,
      input.xUserId,
      input.username,
      input.displayName ?? null,
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
  audit: XAccountAuditInput,
): Promise<void> {
  const now = jstNow();
  const existing = await getXAccountById(db, id);
  if (!existing) return;
  const update = db.prepare(
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
    );
  const appendAudit = db.prepare(
    `INSERT INTO cubelic_audit_logs
      (audit_id, actor, action, entity_type, entity_id, before_json, after_json, timestamp, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `aud_${crypto.randomUUID()}`,
    audit.actor,
    audit.action,
    audit.entityType,
    audit.entityId,
    JSON.stringify(audit.before),
    JSON.stringify(audit.after),
    now,
    audit.correlationId,
  );
  await db.batch([update, appendAudit]);
}
