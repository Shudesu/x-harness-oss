import { jstNow } from './utils.js';

export interface DbStepSequence {
  id: string;
  x_account_id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface DbStepMessage {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_minutes: number;
  action_type: string;
  template: string;
  link: string | null;
  condition_tag: string | null;
  created_at: string;
}

export interface DbStepEnrollment {
  id: string;
  sequence_id: string;
  x_user_id: string;
  x_username: string | null;
  current_step: number;
  next_run_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function createStepSequence(db: D1Database, xAccountId: string, name: string): Promise<DbStepSequence> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare('INSERT INTO step_sequences (id, x_account_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .bind(id, xAccountId, name, now, now)
    .first<DbStepSequence>();
  return result!;
}

export async function getStepSequences(db: D1Database, xAccountId?: string): Promise<DbStepSequence[]> {
  if (xAccountId) {
    const result = await db.prepare('SELECT * FROM step_sequences WHERE x_account_id = ? ORDER BY created_at DESC').bind(xAccountId).all<DbStepSequence>();
    return result.results;
  }
  const result = await db.prepare('SELECT * FROM step_sequences ORDER BY created_at DESC').all<DbStepSequence>();
  return result.results;
}

export async function getStepSequenceById(db: D1Database, id: string): Promise<DbStepSequence | null> {
  return db.prepare('SELECT * FROM step_sequences WHERE id = ?').bind(id).first<DbStepSequence>();
}

export async function deleteStepSequence(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM step_sequences WHERE id = ?').bind(id).run();
}

export async function addStepMessage(db: D1Database, sequenceId: string, stepOrder: number, delayMinutes: number, actionType: string, template: string, link?: string, conditionTag?: string): Promise<DbStepMessage> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare('INSERT INTO step_messages (id, sequence_id, step_order, delay_minutes, action_type, template, link, condition_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(id, sequenceId, stepOrder, delayMinutes, actionType, template, link ?? null, conditionTag ?? null, now)
    .first<DbStepMessage>();
  return result!;
}

export async function getStepMessages(db: D1Database, sequenceId: string): Promise<DbStepMessage[]> {
  const result = await db.prepare('SELECT * FROM step_messages WHERE sequence_id = ? ORDER BY step_order').bind(sequenceId).all<DbStepMessage>();
  return result.results;
}

export async function enrollUser(db: D1Database, sequenceId: string, xUserId: string, xUsername: string | null): Promise<DbStepEnrollment> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const firstStep = await db.prepare('SELECT delay_minutes FROM step_messages WHERE sequence_id = ? ORDER BY step_order LIMIT 1').bind(sequenceId).first<{ delay_minutes: number }>();
  const delayMs = (firstStep?.delay_minutes ?? 0) * 60 * 1000;
  const nextRunAt = new Date(Date.now() + delayMs).toISOString();
  const result = await db
    .prepare('INSERT INTO step_enrollments (id, sequence_id, x_user_id, x_username, current_step, next_run_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?) RETURNING *')
    .bind(id, sequenceId, xUserId, xUsername, nextRunAt, 'active', now, now)
    .first<DbStepEnrollment>();
  return result!;
}

export async function getDueEnrollments(db: D1Database): Promise<DbStepEnrollment[]> {
  const now = new Date().toISOString();
  const result = await db
    .prepare("SELECT * FROM step_enrollments WHERE status = 'active' AND next_run_at <= ?")
    .bind(now)
    .all<DbStepEnrollment>();
  return result.results;
}

export async function advanceEnrollment(db: D1Database, id: string, nextStep: number, nextRunAt: string | null, status: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare('UPDATE step_enrollments SET current_step = ?, next_run_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(nextStep, nextRunAt, status, now, id)
    .run();
}

export async function getEnrollments(db: D1Database, sequenceId: string): Promise<DbStepEnrollment[]> {
  const result = await db.prepare('SELECT * FROM step_enrollments WHERE sequence_id = ? ORDER BY created_at DESC').bind(sequenceId).all<DbStepEnrollment>();
  return result.results;
}
