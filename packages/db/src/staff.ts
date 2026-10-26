import { hashApiKey } from './crypto.js';
import { jstNow } from './utils.js';

export interface DbStaffMember {
  id: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  api_key: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createStaffMember(
  db: D1Database,
  { name, role, apiKey }: { name: string; role: 'admin' | 'editor' | 'viewer'; apiKey: string },
): Promise<DbStaffMember> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      'INSERT INTO staff_members (id, name, role, api_key, api_key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(id, name, role, `revoked:${id}`, await hashApiKey(apiKey), now, now)
    .first<DbStaffMember>();
  return result!;
}

export async function getStaffMembers(db: D1Database): Promise<DbStaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at DESC')
    .all<DbStaffMember>();
  return result.results;
}

export async function getStaffMemberById(
  db: D1Database,
  id: string,
): Promise<DbStaffMember | null> {
  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<DbStaffMember>();
}

export async function getStaffMemberByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<DbStaffMember | null> {
  const hash = await hashApiKey(apiKey);
  const member = await db.prepare('SELECT * FROM staff_members WHERE api_key_hash = ? AND is_active = 1').bind(hash).first<DbStaffMember>();
  if (member) return member;
  // Upgrade legacy keys on successful authentication without changing the key.
  const legacy = await db.prepare('SELECT * FROM staff_members WHERE api_key_hash IS NULL AND api_key = ? AND is_active = 1').bind(apiKey).first<DbStaffMember>();
  if (legacy) await db.prepare('UPDATE staff_members SET api_key_hash = ?, api_key = ? WHERE id = ? AND api_key_hash IS NULL').bind(hash, `revoked:${legacy.id}`, legacy.id).run();
  return legacy;
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  updates: { name?: string; role?: 'admin' | 'editor' | 'viewer'; isActive?: boolean },
): Promise<DbStaffMember | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (fields.length === 0) {
    return getStaffMemberById(db, id);
  }

  const now = jstNow();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  return db
    .prepare(`UPDATE staff_members SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<DbStaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function updateStaffLastLogin(db: D1Database, id: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE staff_members SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
}
