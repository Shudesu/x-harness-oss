import { jstNow } from './utils.js';

export interface DbEngagementGate {
  id: string;
  x_account_id: string;
  post_id: string;
  trigger_type: string;
  action_type: string;
  template: string;
  link: string | null;
  is_active: number;
  line_harness_url: string | null;
  line_harness_api_key: string | null;
  line_harness_tag: string | null;
  line_harness_scenario_id: string | null;
  lottery_enabled: number;
  lottery_rate: number;
  lottery_win_template: string | null;
  lottery_lose_template: string | null;
  polling_strategy: string;
  expires_at: string | null;
  next_poll_at: string | null;
  api_calls_total: number;
  require_like: number;
  require_repost: number;
  require_follow: number;
  last_reply_since_id: string | null;
  reply_keyword: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbDelivery {
  id: string;
  gate_id: string;
  x_user_id: string;
  x_username: string | null;
  delivered_post_id: string | null;
  status: string;
  token: string | null;
  consumed_at: string | null;
  created_at: string;
}

export interface CreateGateInput {
  xAccountId: string;
  postId: string;
  triggerType: string;
  actionType: string;
  template: string;
  link?: string;
  lineHarnessUrl?: string;
  lineHarnessApiKey?: string;
  lineHarnessTag?: string;
  lineHarnessScenarioId?: string;
  lotteryEnabled?: boolean;
  lotteryRate?: number;
  lotteryWinTemplate?: string;
  lotteryLoseTemplate?: string;
  pollingStrategy?: string;
  expiresAfterHours?: number;
  requireLike?: boolean;
  requireRepost?: boolean;
  requireFollow?: boolean;
  replyKeyword?: string;
}

export async function createEngagementGate(db: D1Database, input: CreateGateInput): Promise<DbEngagementGate> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const strategy = input.pollingStrategy ?? 'hot_window';

  let expiresAt: string | null = null;
  if (input.expiresAfterHours !== undefined) {
    expiresAt = new Date(new Date(now).getTime() + input.expiresAfterHours * 60 * 60_000).toISOString();
  } else if (strategy === 'hot_window') {
    expiresAt = new Date(new Date(now).getTime() + 72 * 60 * 60_000).toISOString();
  }

  const nextPollAt = strategy === 'manual' ? null : now;

  const result = await db
    .prepare(`
      INSERT INTO engagement_gates (id, x_account_id, post_id, trigger_type, action_type, template, link, line_harness_url, line_harness_api_key, line_harness_tag, line_harness_scenario_id, lottery_enabled, lottery_rate, lottery_win_template, lottery_lose_template, polling_strategy, expires_at, next_poll_at, api_calls_total, require_like, require_repost, require_follow, reply_keyword, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `)
    .bind(id, input.xAccountId, input.postId, input.triggerType, input.actionType, input.template, input.link ?? null, input.lineHarnessUrl ?? null, input.lineHarnessApiKey ?? null, input.lineHarnessTag ?? null, input.lineHarnessScenarioId ?? null, input.lotteryEnabled ? 1 : 0, input.lotteryRate ?? 100, input.lotteryWinTemplate ?? null, input.lotteryLoseTemplate ?? null, strategy, expiresAt, nextPollAt, input.requireLike ? 1 : 0, input.requireRepost ? 1 : 0, input.requireFollow ? 1 : 0, input.replyKeyword ?? null, now, now)
    .first<DbEngagementGate>();
  return result!;
}

export async function getEngagementGates(db: D1Database, opts: { activeOnly?: boolean } = {}): Promise<DbEngagementGate[]> {
  const where = opts.activeOnly ? 'WHERE is_active = 1' : '';
  const result = await db
    .prepare(`SELECT * FROM engagement_gates ${where} ORDER BY created_at DESC`)
    .all<DbEngagementGate>();
  return result.results;
}

export async function getEngagementGateById(db: D1Database, id: string): Promise<DbEngagementGate | null> {
  return db.prepare('SELECT * FROM engagement_gates WHERE id = ?').bind(id).first<DbEngagementGate>();
}

export async function updateEngagementGate(db: D1Database, id: string, updates: Partial<CreateGateInput & { isActive: boolean }>): Promise<DbEngagementGate | null> {
  const existing = await getEngagementGateById(db, id);
  if (!existing) return null;
  const now = jstNow();

  const newStrategy = updates.pollingStrategy ?? existing.polling_strategy;
  const strategyChanged = updates.pollingStrategy !== undefined && updates.pollingStrategy !== existing.polling_strategy;

  let newExpiresAt = existing.expires_at;
  if (updates.expiresAfterHours !== undefined) {
    newExpiresAt = new Date(Date.now() + updates.expiresAfterHours * 60 * 60_000).toISOString();
  } else if (strategyChanged) {
    // Reset expires_at when strategy changes to avoid stale deadlines
    if (newStrategy === 'hot_window') {
      newExpiresAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    } else if (newStrategy === 'manual') {
      newExpiresAt = null;
    } else {
      // constant with no explicit expiry — clear old hot_window deadline
      newExpiresAt = null;
    }
  }

  const isReactivating = updates.isActive === true && !existing.is_active;

  // When reactivating an expired gate, refresh expires_at so it doesn't
  // immediately get deactivated again by isExpired()
  if (isReactivating && !strategyChanged && updates.expiresAfterHours === undefined) {
    if (newStrategy === 'hot_window') {
      newExpiresAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    }
    // constant/manual: keep existing expires_at (null = no expiry)
  }

  let newNextPollAt = existing.next_poll_at;
  if (isReactivating || strategyChanged) {
    newNextPollAt = newStrategy === 'manual' ? null : now;
  }

  const result = await db
    .prepare(`
      UPDATE engagement_gates SET
        post_id = ?, trigger_type = ?, action_type = ?, template = ?, link = ?,
        is_active = ?, line_harness_url = ?, line_harness_api_key = ?, line_harness_tag = ?, line_harness_scenario_id = ?,
        lottery_enabled = ?, lottery_rate = ?, lottery_win_template = ?, lottery_lose_template = ?,
        polling_strategy = ?, expires_at = ?, next_poll_at = ?,
        require_like = ?, require_repost = ?, require_follow = ?, reply_keyword = ?,
        updated_at = ?
      WHERE id = ? RETURNING *
    `)
    .bind(
      updates.postId ?? existing.post_id,
      updates.triggerType ?? existing.trigger_type,
      updates.actionType ?? existing.action_type,
      updates.template ?? existing.template,
      updates.link ?? existing.link,
      updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : existing.is_active,
      updates.lineHarnessUrl ?? existing.line_harness_url,
      updates.lineHarnessApiKey ?? existing.line_harness_api_key,
      updates.lineHarnessTag ?? existing.line_harness_tag,
      updates.lineHarnessScenarioId ?? existing.line_harness_scenario_id,
      updates.lotteryEnabled !== undefined ? (updates.lotteryEnabled ? 1 : 0) : existing.lottery_enabled,
      updates.lotteryRate ?? existing.lottery_rate,
      updates.lotteryWinTemplate ?? existing.lottery_win_template,
      updates.lotteryLoseTemplate ?? existing.lottery_lose_template,
      newStrategy,
      newExpiresAt,
      newNextPollAt,
      updates.requireLike !== undefined ? (updates.requireLike ? 1 : 0) : existing.require_like,
      updates.requireRepost !== undefined ? (updates.requireRepost ? 1 : 0) : existing.require_repost,
      updates.requireFollow !== undefined ? (updates.requireFollow ? 1 : 0) : existing.require_follow,
      updates.replyKeyword ?? existing.reply_keyword,
      now, id,
    )
    .first<DbEngagementGate>();
  return result;
}

export async function deleteEngagementGate(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM engagement_gates WHERE id = ?').bind(id).run();
}

export async function getDeliveries(db: D1Database, gateId: string, opts: { limit?: number; offset?: number } = {}): Promise<DbDelivery[]> {
  const { limit = 50, offset = 0 } = opts;
  const result = await db
    .prepare('SELECT * FROM engagement_gate_deliveries WHERE gate_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(gateId, limit, offset)
    .all<DbDelivery>();
  return result.results;
}

export async function getDeliveredUserIds(db: D1Database, gateId: string): Promise<Set<string>> {
  // Only treat 'delivered' and 'pending' rows as already handled.
  // 'failed' rows are retryable — do not suppress future delivery attempts.
  const result = await db
    .prepare("SELECT x_user_id FROM engagement_gate_deliveries WHERE gate_id = ? AND status IN ('delivered', 'pending')")
    .bind(gateId)
    .all<{ x_user_id: string }>();
  return new Set(result.results.map((r) => r.x_user_id));
}

export async function createDelivery(db: D1Database, gateId: string, xUserId: string, xUsername: string | null, deliveredPostId: string | null, status: string): Promise<DbDelivery> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = jstNow();
  const result = await db
    .prepare('INSERT INTO engagement_gate_deliveries (id, gate_id, x_user_id, x_username, delivered_post_id, status, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(id, gateId, xUserId, xUsername, deliveredPostId, status, token, now)
    .first<DbDelivery>();
  return result!;
}

export async function updateDeliveryStatus(db: D1Database, id: string, status: string, deliveredPostId?: string): Promise<void> {
  await db
    .prepare('UPDATE engagement_gate_deliveries SET status = ?, delivered_post_id = ? WHERE id = ?')
    .bind(status, deliveredPostId ?? null, id)
    .run();
}

export interface ResolvedToken {
  xUserId: string;
  xUsername: string | null;
  gateId: string;
  tag: string | null;
  scenarioId: string | null;
}

export async function updateGateSinceId(db: D1Database, gateId: string, sinceId: string): Promise<void> {
  await db
    .prepare('UPDATE engagement_gates SET last_reply_since_id = ?, updated_at = ? WHERE id = ?')
    .bind(sinceId, jstNow(), gateId)
    .run();
}

export async function getEligibleDelivery(db: D1Database, gateId: string, xUsername: string): Promise<DbDelivery | null> {
  return db
    .prepare("SELECT * FROM engagement_gate_deliveries WHERE gate_id = ? AND x_username = ? AND status IN ('delivered', 'pending')")
    .bind(gateId, xUsername)
    .first<DbDelivery>();
}

export async function resolveToken(db: D1Database, token: string): Promise<ResolvedToken | null> {
  // Atomically mark the token as consumed and return its data in a single statement.
  // If consumed_at is already set (or token doesn't exist), the UPDATE matches zero rows
  // and we return null — preventing double-redemption races.
  const now = jstNow();
  const row = await db
    .prepare('UPDATE engagement_gate_deliveries SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL RETURNING x_user_id, x_username, gate_id')
    .bind(now, token)
    .first<{ x_user_id: string; x_username: string | null; gate_id: string }>();
  if (!row) return null;

  // Fetch the gate's LINE Harness config (tag + scenario)
  const gate = await db
    .prepare('SELECT line_harness_tag, line_harness_scenario_id FROM engagement_gates WHERE id = ?')
    .bind(row.gate_id)
    .first<{ line_harness_tag: string | null; line_harness_scenario_id: string | null }>();

  return {
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    gateId: row.gate_id,
    tag: gate?.line_harness_tag ?? null,
    scenarioId: gate?.line_harness_scenario_id ?? null,
  };
}
