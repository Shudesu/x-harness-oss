import type {
  ContentItem,
  DraftCandidate,
  EventRecord,
  GasSetlistV1,
  MemberMasterV1,
  ManualProductionAuthorityV1,
  MediaAsset,
  PostMetrics,
  RejectReason,
  SongMasterV1,
  XDraftInput,
  XDraftResult,
  XHarnessInertDraftV1,
} from '@x-harness/content-os';

type AuditActor = 'human' | 'hermes' | 'system' | 'codex';

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AuditInput {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  correlationId: string;
}

function cubelicAuditStatement(db: D1Database, input: AuditInput, timestamp = nowIso()): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO cubelic_audit_logs (audit_id, actor, action, entity_type, entity_id, before_json, after_json, timestamp, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    `aud_${crypto.randomUUID()}`, input.actor, input.action, input.entityType, input.entityId,
    JSON.stringify(input.before), JSON.stringify(input.after), timestamp, input.correlationId,
  );
}

async function runCubelicMutation(db: D1Database, statements: D1PreparedStatement[], audits: AuditInput[]): Promise<void> {
  if (audits.length === 0) throw new Error('CUBΣLIC state mutations require at least one audit event');
  await db.batch([...statements, ...audits.map((audit) => cubelicAuditStatement(db, audit))]);
}

export async function appendCubelicAudit(db: D1Database, input: AuditInput): Promise<void> {
  await cubelicAuditStatement(db, input).run();
}

export async function bootstrapCubelicOperator(
  db: D1Database,
  input: { name: string; apiKey: string },
  audit: AuditInput,
): Promise<{ id: string; name: string; role: 'admin'; apiKey: string } | null> {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const insert = db.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, created_at, updated_at)
     SELECT ?, ?, 'admin', ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM staff_members WHERE is_active = 1)`,
  ).bind(id, input.name, input.apiKey, timestamp, timestamp);
  const conditionalAudit = db.prepare(
    `INSERT INTO cubelic_audit_logs (
      audit_id, actor, action, entity_type, entity_id, before_json, after_json,
      timestamp, correlation_id
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM staff_members WHERE id = ?)`,
  ).bind(
    `aud_${crypto.randomUUID()}`,
    audit.actor,
    audit.action,
    audit.entityType,
    audit.entityId,
    JSON.stringify(audit.before),
    JSON.stringify(audit.after),
    timestamp,
    audit.correlationId,
    id,
  );
  await db.batch([insert, conditionalAudit]);
  const created = await db.prepare(
    'SELECT id FROM staff_members WHERE id = ?',
  ).bind(id).first<{ id: string }>();
  return created ? { id, name: input.name, role: 'admin', apiKey: input.apiKey } : null;
}

export interface RejectionInput {
  actor: AuditActor;
  reasons: RejectReason[];
  requestMethod: string;
  requestPath: string;
  correlationId: string;
}

function cubelicRejectionMutation(db: D1Database, input: RejectionInput, occurredAt = nowIso()): {
  statements: D1PreparedStatement[];
  audits: AuditInput[];
} {
  const reasons = [...new Set(input.reasons)];
  const statements = reasons.map((reason) => db.prepare(
    'INSERT INTO cubelic_rejection_events (rejection_id, actor, reason, request_method, request_path, correlation_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(`rej_${crypto.randomUUID()}`, input.actor, reason, input.requestMethod, input.requestPath, input.correlationId, occurredAt));
  const audits = reasons.map((reason): AuditInput => ({
    actor: input.actor,
    action: 'rejection.recorded',
    entityType: 'rejection',
    entityId: `${input.correlationId}:${reason}`,
    before: {},
    after: { reason, requestMethod: input.requestMethod, requestPath: input.requestPath, occurredAt },
    correlationId: input.correlationId,
  }));
  return { statements, audits };
}

export async function recordCubelicRejections(db: D1Database, input: RejectionInput): Promise<void> {
  if (input.reasons.length === 0) return;
  const rejection = cubelicRejectionMutation(db, input);
  try {
    await runCubelicMutation(db, rejection.statements, rejection.audits);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.prepare(
      `SELECT reason FROM cubelic_rejection_events WHERE correlation_id = ? AND reason IN (${input.reasons.map(() => '?').join(',')})`,
    ).bind(input.correlationId, ...input.reasons).all<{ reason: RejectReason }>();
    if (new Set(existing.results.map((row) => row.reason)).size !== new Set(input.reasons).size) throw error;
  }
}

export async function getCubelicRejectionSummary(
  db: D1Database,
  since: string,
): Promise<Array<{ reason: RejectReason; count: number }>> {
  const result = await db.prepare(
    'SELECT reason, COUNT(*) AS count FROM cubelic_rejection_events WHERE occurred_at >= ? GROUP BY reason ORDER BY count DESC, reason ASC',
  ).bind(since).all<{ reason: RejectReason; count: number }>();
  return result.results;
}

interface EventRow {
  event_id: string;
  title: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  state: EventRecord['state'];
  official_url: string | null;
  ticket_url: string | null;
  event_tags: string;
  filming_policy: string;
}

function mapEvent(row: EventRow): EventRecord {
  return {
    event_id: row.event_id,
    title: row.title,
    venue: row.venue,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    state: row.state,
    official_url: row.official_url,
    ticket_url: row.ticket_url,
    event_tags: json<string[]>(row.event_tags),
    filming_policy: json<EventRecord['filming_policy']>(row.filming_policy),
  };
}

export async function createCubelicEvent(db: D1Database, event: EventRecord, audit: AuditInput): Promise<EventRecord> {
  const now = nowIso();
  const statement = db.prepare(
    'INSERT INTO cubelic_events (event_id, title, venue, starts_at, ends_at, state, official_url, ticket_url, event_tags, filming_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    event.event_id, event.title, event.venue, event.starts_at, event.ends_at, event.state,
    event.official_url ?? null, event.ticket_url ?? null, JSON.stringify(event.event_tags), JSON.stringify(event.filming_policy), now, now,
  );
  await runCubelicMutation(db, [statement], [audit]);
  return event;
}

export async function getCubelicEvent(db: D1Database, eventId: string): Promise<EventRecord | null> {
  const row = await db.prepare('SELECT * FROM cubelic_events WHERE event_id = ?').bind(eventId).first<EventRow>();
  return row ? mapEvent(row) : null;
}

export async function listCubelicEvents(db: D1Database): Promise<EventRecord[]> {
  const result = await db.prepare('SELECT * FROM cubelic_events ORDER BY starts_at DESC').all<EventRow>();
  return result.results.map(mapEvent);
}

export async function updateCubelicEvent(db: D1Database, event: EventRecord, audit: AuditInput): Promise<EventRecord> {
  const statement = db.prepare(
    'UPDATE cubelic_events SET title = ?, venue = ?, starts_at = ?, ends_at = ?, state = ?, official_url = ?, ticket_url = ?, event_tags = ?, filming_policy = ?, updated_at = ? WHERE event_id = ?',
  ).bind(
    event.title, event.venue, event.starts_at, event.ends_at, event.state, event.official_url ?? null,
    event.ticket_url ?? null, JSON.stringify(event.event_tags), JSON.stringify(event.filming_policy), nowIso(), event.event_id,
  );
  await runCubelicMutation(db, [statement], [audit]);
  return event;
}

export async function upsertCubelicSongMaster(db: D1Database, master: SongMasterV1, audits: AuditInput[]): Promise<number> {
  const updatedAt = nowIso();
  const statements = master.songs.map((song) => db.prepare(
    'INSERT INTO cubelic_songs (song_id, title, aliases, active, source_generated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET title = excluded.title, aliases = excluded.aliases, active = excluded.active, source_generated_at = excluded.source_generated_at, updated_at = excluded.updated_at',
  ).bind(song.song_id, song.title, JSON.stringify(song.aliases), song.active ? 1 : 0, master.generated_at, updatedAt));
  await runCubelicMutation(db, statements, audits);
  return master.songs.length;
}

export async function upsertCubelicMemberMaster(db: D1Database, master: MemberMasterV1, audits: AuditInput[]): Promise<number> {
  const updatedAt = nowIso();
  const statements = master.members.map((member) => db.prepare(
    'INSERT INTO cubelic_members (member_id, display_name, aliases, active, source_generated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET display_name = excluded.display_name, aliases = excluded.aliases, active = excluded.active, source_generated_at = excluded.source_generated_at, updated_at = excluded.updated_at',
  ).bind(member.member_id, member.display_name, JSON.stringify(member.aliases), member.active ? 1 : 0, master.generated_at, updatedAt));
  await runCubelicMutation(db, statements, audits);
  return master.members.length;
}

export async function getCubelicSongMasterEntry(db: D1Database, songId: string): Promise<SongMasterV1['songs'][number] | null> {
  const row = await db.prepare('SELECT song_id, title, aliases, active FROM cubelic_songs WHERE song_id = ?').bind(songId).first<{
    song_id: string; title: string; aliases: string; active: number;
  }>();
  return row ? { song_id: row.song_id, title: row.title, aliases: json<string[]>(row.aliases), active: row.active === 1 } : null;
}

export async function getCubelicMemberMasterEntry(db: D1Database, memberId: string): Promise<MemberMasterV1['members'][number] | null> {
  const row = await db.prepare('SELECT member_id, display_name, aliases, active FROM cubelic_members WHERE member_id = ?').bind(memberId).first<{
    member_id: string; display_name: string; aliases: string; active: number;
  }>();
  return row ? { member_id: row.member_id, display_name: row.display_name, aliases: json<string[]>(row.aliases), active: row.active === 1 } : null;
}

export async function validateCubelicSetlistSongs(
  db: D1Database,
  songs: GasSetlistV1['songs'],
): Promise<{ unknownSongIds: string[]; titleMismatches: string[] }> {
  const unknownSongIds: string[] = [];
  const titleMismatches: string[] = [];
  for (const song of songs) {
    const row = await db.prepare('SELECT title, aliases, active FROM cubelic_songs WHERE song_id = ?').bind(song.song_id).first<{
      title: string; aliases: string; active: number;
    }>();
    if (!row || row.active !== 1) {
      unknownSongIds.push(song.song_id);
      continue;
    }
    const acceptedTitles = new Set([row.title, ...json<string[]>(row.aliases)]);
    if (!acceptedTitles.has(song.title)) titleMismatches.push(song.song_id);
  }
  return { unknownSongIds, titleMismatches };
}

export async function validateCubelicContentReferences(
  db: D1Database,
  input: { songIds: string[]; memberIds: string[] },
): Promise<{ unknownSongIds: string[]; unknownMemberIds: string[] }> {
  const [songs, members] = await Promise.all([
    Promise.all(input.songIds.map(async (songId) => ({
      id: songId,
      active: (await db.prepare('SELECT active FROM cubelic_songs WHERE song_id = ?').bind(songId).first<{ active: number }>())?.active === 1,
    }))),
    Promise.all(input.memberIds.map(async (memberId) => ({
      id: memberId,
      active: (await db.prepare('SELECT active FROM cubelic_members WHERE member_id = ?').bind(memberId).first<{ active: number }>())?.active === 1,
    }))),
  ]);
  return {
    unknownSongIds: songs.filter((item) => !item.active).map((item) => item.id),
    unknownMemberIds: members.filter((item) => !item.active).map((item) => item.id),
  };
}

interface ContentRow {
  content_id: string;
  event_id: string | null;
  category: ContentItem['category'];
  target_stage: ContentItem['target_stage'];
  lifecycle: string;
  status: ContentItem['status'];
  source_type: ContentItem['source_type'];
  source_refs: string;
  member_ids: string;
  song_ids: string;
  emotion_tags: string;
  destination: string;
  created_at: string;
  updated_at: string;
}

function mapContent(row: ContentRow): ContentItem {
  return {
    content_id: row.content_id,
    event_id: row.event_id,
    category: row.category,
    target_stage: row.target_stage,
    content_lifecycle: json<ContentItem['content_lifecycle']>(row.lifecycle),
    status: row.status,
    source_type: row.source_type,
    source_refs: json<string[]>(row.source_refs),
    member_ids: json<string[]>(row.member_ids),
    song_ids: json<string[]>(row.song_ids),
    emotion_tags: json<string[]>(row.emotion_tags),
    destination: json<ContentItem['destination']>(row.destination),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createCubelicContent(db: D1Database, item: ContentItem, audit: AuditInput): Promise<ContentItem> {
  const statement = db.prepare(
    'INSERT INTO cubelic_content_items (content_id, event_id, category, target_stage, lifecycle, status, source_type, source_refs, member_ids, song_ids, emotion_tags, destination, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    item.content_id, item.event_id, item.category, item.target_stage, JSON.stringify(item.content_lifecycle), item.status,
    item.source_type, JSON.stringify(item.source_refs), JSON.stringify(item.member_ids), JSON.stringify(item.song_ids),
    JSON.stringify(item.emotion_tags), JSON.stringify(item.destination), item.created_at, item.updated_at,
  );
  await runCubelicMutation(db, [statement], [audit]);
  return item;
}

export async function getCubelicContent(db: D1Database, contentId: string): Promise<ContentItem | null> {
  const row = await db.prepare('SELECT * FROM cubelic_content_items WHERE content_id = ?').bind(contentId).first<ContentRow>();
  return row ? mapContent(row) : null;
}

export async function listCubelicContent(db: D1Database): Promise<ContentItem[]> {
  const result = await db.prepare('SELECT * FROM cubelic_content_items ORDER BY created_at DESC').all<ContentRow>();
  return result.results.map(mapContent);
}

export async function updateCubelicContent(db: D1Database, item: ContentItem, audit: AuditInput): Promise<ContentItem> {
  const statement = db.prepare(
    'UPDATE cubelic_content_items SET event_id = ?, category = ?, target_stage = ?, lifecycle = ?, status = ?, source_type = ?, source_refs = ?, member_ids = ?, song_ids = ?, emotion_tags = ?, destination = ?, updated_at = ? WHERE content_id = ?',
  ).bind(
    item.event_id, item.category, item.target_stage, JSON.stringify(item.content_lifecycle), item.status, item.source_type,
    JSON.stringify(item.source_refs), JSON.stringify(item.member_ids), JSON.stringify(item.song_ids), JSON.stringify(item.emotion_tags),
    JSON.stringify(item.destination), item.updated_at, item.content_id,
  );
  await runCubelicMutation(db, [statement], [audit]);
  return item;
}

interface MediaRow {
  asset_id: string;
  event_id: string;
  path: string;
  sha256: string;
  duration_seconds: number;
  orientation: MediaAsset['orientation'];
  resolution: string;
  audio_present: number;
  rights: string;
  privacy: string;
  quality: string;
  status: MediaAsset['status'];
}

function mapMedia(row: MediaRow): MediaAsset {
  return {
    asset_id: row.asset_id,
    event_id: row.event_id,
    path: row.path,
    sha256: row.sha256,
    duration_seconds: row.duration_seconds,
    orientation: row.orientation,
    resolution: row.resolution,
    audio_present: row.audio_present === 1,
    rights: json<MediaAsset['rights']>(row.rights),
    privacy: json<MediaAsset['privacy']>(row.privacy),
    quality: json<MediaAsset['quality']>(row.quality),
    status: row.status,
  };
}

export async function getCubelicMedia(db: D1Database, assetId: string): Promise<MediaAsset | null> {
  const row = await db.prepare('SELECT * FROM cubelic_media_assets WHERE asset_id = ?').bind(assetId).first<MediaRow>();
  return row ? mapMedia(row) : null;
}

export async function findCubelicMediaByHash(db: D1Database, sha256: string): Promise<MediaAsset | null> {
  const row = await db.prepare('SELECT * FROM cubelic_media_assets WHERE sha256 = ?').bind(sha256).first<MediaRow>();
  return row ? mapMedia(row) : null;
}

export async function createCubelicMedia(
  db: D1Database,
  asset: MediaAsset,
  rejectReasons: RejectReason[],
  audit: AuditInput,
  rejectionInput?: RejectionInput,
): Promise<MediaAsset> {
  const now = nowIso();
  const statement = db.prepare(
    'INSERT INTO cubelic_media_assets (asset_id, event_id, path, sha256, duration_seconds, orientation, resolution, audio_present, rights, privacy, quality, status, reject_reasons, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    asset.asset_id, asset.event_id, asset.path, asset.sha256, asset.duration_seconds, asset.orientation, asset.resolution,
    asset.audio_present ? 1 : 0, JSON.stringify(asset.rights), JSON.stringify(asset.privacy), JSON.stringify(asset.quality),
    asset.status, JSON.stringify(rejectReasons), now, now,
  );
  const rejection = rejectionInput && rejectionInput.reasons.length > 0
    ? cubelicRejectionMutation(db, rejectionInput)
    : { statements: [], audits: [] };
  await runCubelicMutation(db, [statement, ...rejection.statements], [audit, ...rejection.audits]);
  return asset;
}

export async function updateCubelicMediaReview(
  db: D1Database,
  asset: MediaAsset,
  rejectReasons: RejectReason[],
  audit: AuditInput,
  rejectionInput?: RejectionInput,
): Promise<MediaAsset> {
  const statement = db.prepare(
    'UPDATE cubelic_media_assets SET rights = ?, privacy = ?, status = ?, reject_reasons = ?, updated_at = ? WHERE asset_id = ?',
  ).bind(JSON.stringify(asset.rights), JSON.stringify(asset.privacy), asset.status, JSON.stringify(rejectReasons), nowIso(), asset.asset_id);
  const rejection = rejectionInput && rejectionInput.reasons.length > 0
    ? cubelicRejectionMutation(db, rejectionInput)
    : { statements: [], audits: [] };
  await runCubelicMutation(db, [statement, ...rejection.statements], [audit, ...rejection.audits]);
  return asset;
}

export async function createCubelicSetlist(
  db: D1Database,
  payload: GasSetlistV1,
  payloadSha256: string,
  auditFor: (setlistId: string) => AuditInput,
): Promise<{ setlistId: string; idempotentReplay: boolean }> {
  const existing = await db.prepare('SELECT setlist_id FROM cubelic_setlists WHERE payload_sha256 = ?').bind(payloadSha256).first<{ setlist_id: string }>();
  if (existing) return { setlistId: existing.setlist_id, idempotentReplay: true };
  const setlistId = `set_${crypto.randomUUID()}`;
  const statement = db.prepare(
    'INSERT INTO cubelic_setlists (setlist_id, event_id, schema_version, payload, payload_sha256, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(setlistId, payload.event_id, payload.schema_version, JSON.stringify(payload), payloadSha256, payload.confirmed_at, nowIso());
  await runCubelicMutation(db, [statement], [auditFor(setlistId)]);
  return { setlistId, idempotentReplay: false };
}

export async function getCubelicSetlistForEvent(db: D1Database, eventId: string): Promise<GasSetlistV1 | null> {
  const row = await db.prepare('SELECT payload FROM cubelic_setlists WHERE event_id = ? ORDER BY created_at DESC LIMIT 1').bind(eventId).first<{ payload: string }>();
  return row ? json<GasSetlistV1>(row.payload) : null;
}

interface DraftRow {
  draft_id: string;
  content_id: string;
  account_id: string;
  text: string;
  media_asset_ids: string;
  category: DraftCandidate['category'];
  template_id: string;
  template_version: string;
  variant: DraftCandidate['variant'];
  target_stage: DraftCandidate['target_stage'];
  emotion_tags: string;
  hashtags: string;
  destination_url: string;
  utm: string;
  quality_score: number;
  quality_breakdown: string;
  freshness_score: number;
  rights_gate: DraftCandidate['rights_gate'];
  approval_status: DraftCandidate['approval_status'];
  approved_by: string | null;
  approved_at: string | null;
  x_harness_inbox_id: string | null;
  risks: string;
  human_review_required: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

function mapDraft(row: DraftRow): DraftCandidate {
  return {
    draft_id: row.draft_id,
    content_id: row.content_id,
    account_id: row.account_id,
    text: row.text,
    media_asset_ids: json<string[]>(row.media_asset_ids),
    category: row.category,
    template_id: row.template_id,
    template_version: row.template_version,
    variant: row.variant,
    target_stage: row.target_stage,
    emotion_tags: json<string[]>(row.emotion_tags),
    hashtags: json<string[]>(row.hashtags),
    destination_url: row.destination_url,
    utm: json<DraftCandidate['utm']>(row.utm),
    quality_score: row.quality_score,
    quality_breakdown: json<DraftCandidate['quality_breakdown']>(row.quality_breakdown),
    freshness_score: row.freshness_score,
    rights_gate: row.rights_gate,
    approval_status: row.approval_status,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    x_harness_inbox_id: row.x_harness_inbox_id,
    risks: json<string[]>(row.risks),
    human_review_required: json<string[]>(row.human_review_required),
    idempotency_key: row.idempotency_key,
    scheduled_at: null,
    published_post_id: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createCubelicDrafts(db: D1Database, drafts: DraftCandidate[], audits: AuditInput[]): Promise<DraftCandidate[]> {
  const statements = drafts.map((draft) => db.prepare(
    'INSERT INTO cubelic_draft_posts (draft_id, content_id, account_id, text, media_asset_ids, category, template_id, template_version, variant, target_stage, emotion_tags, hashtags, destination_url, utm, quality_score, quality_breakdown, freshness_score, rights_gate, approval_status, risks, human_review_required, idempotency_key, scheduled_at, published_post_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)',
  ).bind(
    draft.draft_id, draft.content_id, draft.account_id, draft.text, JSON.stringify(draft.media_asset_ids), draft.category,
    draft.template_id, draft.template_version, draft.variant, draft.target_stage, JSON.stringify(draft.emotion_tags), JSON.stringify(draft.hashtags),
    draft.destination_url, JSON.stringify(draft.utm), draft.quality_score, JSON.stringify(draft.quality_breakdown), draft.freshness_score,
    draft.rights_gate, draft.approval_status, JSON.stringify(draft.risks), JSON.stringify(draft.human_review_required), draft.idempotency_key,
    draft.created_at, draft.updated_at,
  ));
  try {
    await runCubelicMutation(db, statements, audits);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  const stored = await Promise.all(drafts.map((draft) => db.prepare(
    'SELECT * FROM cubelic_draft_posts WHERE idempotency_key = ?',
  ).bind(draft.idempotency_key).first<DraftRow>()));
  if (stored.some((row) => !row)) throw new Error('A generated draft could not be persisted');
  return stored.map((row) => mapDraft(row!));
}

export async function getCubelicDraft(db: D1Database, draftId: string): Promise<DraftCandidate | null> {
  const row = await db.prepare('SELECT * FROM cubelic_draft_posts WHERE draft_id = ?').bind(draftId).first<DraftRow>();
  return row ? mapDraft(row) : null;
}

export async function listCubelicDrafts(db: D1Database, status?: string): Promise<DraftCandidate[]> {
  const statement = status
    ? db.prepare('SELECT * FROM cubelic_draft_posts WHERE approval_status = ? ORDER BY created_at DESC').bind(status)
    : db.prepare('SELECT * FROM cubelic_draft_posts ORDER BY created_at DESC');
  const result = await statement.all<DraftRow>();
  return result.results.map(mapDraft);
}

export async function updateCubelicDraftText(db: D1Database, draftId: string, text: string, audit: AuditInput): Promise<void> {
  const statement = db.prepare('UPDATE cubelic_draft_posts SET text = ?, updated_at = ? WHERE draft_id = ?')
    .bind(text, nowIso(), draftId);
  await runCubelicMutation(db, [statement], [audit]);
}

export async function reserveCubelicDraftApproval(
  db: D1Database,
  draftId: string,
  approvedBy: string,
  audit: AuditInput,
): Promise<void> {
  const timestamp = nowIso();
  const statement = db.prepare(
    "UPDATE cubelic_draft_posts SET approval_status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE draft_id = ?",
  ).bind(approvedBy, timestamp, timestamp, draftId);
  await runCubelicMutation(db, [statement], [audit]);
}

export async function setCubelicDraftDecision(db: D1Database, input: {
  draftId: string;
  actor: string;
} & (
  | { status: 'rejected'; rejectReason: RejectReason; inboxId?: never }
  | { status: 'handed_off'; inboxId: string; rejectReason?: never }
), audit: AuditInput, rejectionInput?: RejectionInput): Promise<void> {
  const approvedAt = input.status === 'rejected' ? null : nowIso();
  const statement = db.prepare(
    'UPDATE cubelic_draft_posts SET approval_status = ?, approved_by = ?, approved_at = ?, reject_reason = ?, x_harness_inbox_id = ?, updated_at = ? WHERE draft_id = ?',
  ).bind(input.status, input.actor, approvedAt, input.rejectReason ?? null, input.inboxId ?? null, nowIso(), input.draftId);
  const rejection = rejectionInput && rejectionInput.reasons.length > 0
    ? cubelicRejectionMutation(db, rejectionInput)
    : { statements: [], audits: [] };
  await runCubelicMutation(db, [statement, ...rejection.statements], [audit, ...rejection.audits]);
}

export async function handoffCubelicDraftAndStop(
  db: D1Database,
  input: { draftId: string; actor: string; inboxId: string },
  audits: { draft: AuditInput; operationWindow: AuditInput },
): Promise<void> {
  const updatedAt = nowIso();
  const statements = [
    db.prepare(
      "UPDATE cubelic_draft_posts SET approval_status = 'handed_off', approved_by = ?, approved_at = ?, reject_reason = NULL, x_harness_inbox_id = ?, updated_at = ? WHERE draft_id = ?",
    ).bind(input.actor, updatedAt, input.inboxId, updatedAt, input.draftId),
    db.prepare(
      "INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('emergency_stop', 'true', ?, ?) ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).bind(updatedAt, input.actor),
    db.prepare(
      "DELETE FROM cubelic_system_flags WHERE key IN ('operation_window_event_id', 'operation_window_expires_at')",
    ),
  ];
  await runCubelicMutation(db, statements, [audits.draft, audits.operationWindow]);
}

interface InertDraftIdentityRow {
  inbox_id: string;
  draft_id: string;
  x_account_id: string;
  text: string;
  media_asset_ids: string;
  idempotency_key: string;
}

async function findMatchingCubelicInertDraft(
  db: D1Database,
  xHarnessAccountId: string,
  input: XDraftInput,
): Promise<InertDraftIdentityRow | null> {
  const stored = await db.prepare(
    'SELECT inbox_id, draft_id, x_account_id, text, media_asset_ids, idempotency_key FROM cubelic_x_draft_inbox WHERE idempotency_key = ?',
  ).bind(input.idempotencyKey).first<InertDraftIdentityRow>();
  if (!stored) return null;
  if (
    stored.draft_id !== input.draftId
    || stored.x_account_id !== xHarnessAccountId
    || stored.text !== input.text
    || stored.media_asset_ids !== JSON.stringify(input.mediaAssetIds)
  ) {
    throw new Error('Inert draft idempotency key conflicts with a different canonical payload');
  }
  return stored;
}

export async function createCubelicInertDraft(db: D1Database, xHarnessAccountId: string, input: XDraftInput): Promise<XDraftResult> {
  const existing = await findMatchingCubelicInertDraft(db, xHarnessAccountId, input);
  if (existing) return { inboxId: existing.inbox_id, status: 'inert_draft', idempotentReplay: true };
  const inboxId = `xin_${crypto.randomUUID()}`;
  const textSha256 = await sha256Text(input.text);
  const statement = db.prepare(
    'INSERT INTO cubelic_x_draft_inbox (inbox_id, draft_id, x_account_id, text, media_asset_ids, idempotency_key, status, approved_by, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    inboxId, input.draftId, xHarnessAccountId, input.text, JSON.stringify(input.mediaAssetIds), input.idempotencyKey,
    'inert_draft', input.approvedBy, input.approvedAt, nowIso(),
  );
  try {
    await runCubelicMutation(db, [statement], [{
    actor: 'system',
    action: 'x_harness_inbox.created',
    entityType: 'x_harness_inbox',
    entityId: inboxId,
    before: {},
    after: {
      draftId: input.draftId,
      xHarnessAccountId,
      textSha256,
      mediaAssetIds: input.mediaAssetIds,
      idempotencyKey: input.idempotencyKey,
      status: 'inert_draft',
      approvedByPresent: Boolean(input.approvedBy),
      approvedAt: input.approvedAt,
    },
    correlationId: input.idempotencyKey,
    }]);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  const stored = await findMatchingCubelicInertDraft(db, xHarnessAccountId, input);
  if (!stored) throw new Error('The inert X draft could not be persisted');
  return { inboxId: stored.inbox_id, status: 'inert_draft', idempotentReplay: stored.inbox_id !== inboxId };
}

export async function getCubelicInertDraft(db: D1Database, draftId: string): Promise<XHarnessInertDraftV1 | null> {
  const row = await db.prepare('SELECT * FROM cubelic_x_draft_inbox WHERE draft_id = ?').bind(draftId).first<{
    inbox_id: string;
    draft_id: string;
    x_account_id: string;
    text: string;
    media_asset_ids: string;
    idempotency_key: string;
    status: 'inert_draft';
    approved_by: string;
    approved_at: string;
    created_at: string;
  }>();
  if (!row) return null;
  return {
    schema_version: 'cubelic.x-harness-inert-draft.v1',
    ...row,
    media_asset_ids: json<string[]>(row.media_asset_ids),
  };
}

export async function getCubelicEmergencyStop(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'").first<{ value: string }>();
  return row?.value !== 'false';
}

export async function setCubelicEmergencyStop(db: D1Database, stopped: boolean, actor: string, audit: AuditInput): Promise<void> {
  const statement = db.prepare(
    "INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('emergency_stop', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).bind(stopped ? 'true' : 'false', nowIso(), actor);
  await runCubelicMutation(db, [statement], [audit]);
}

export interface CubelicOperationWindow {
  eventId: string;
  expiresAt: string;
  active: boolean;
}

export async function getCubelicOperationWindow(db: D1Database, at = Date.now()): Promise<CubelicOperationWindow | null> {
  const result = await db.prepare(
    "SELECT key, value FROM cubelic_system_flags WHERE key IN ('operation_window_event_id', 'operation_window_expires_at')",
  ).all<{ key: string; value: string }>();
  const values = new Map(result.results.map((row) => [row.key, row.value]));
  const eventId = values.get('operation_window_event_id');
  const expiresAt = values.get('operation_window_expires_at');
  if (!eventId || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  return { eventId, expiresAt, active: Date.parse(expiresAt) > at };
}

export async function setCubelicOperationWindow(
  db: D1Database,
  input: { eventId: string; expiresAt: string; actor: string },
  audit: AuditInput,
): Promise<void> {
  const updatedAt = nowIso();
  const statements = [
    db.prepare(
      "INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('operation_window_event_id', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).bind(input.eventId, updatedAt, input.actor),
    db.prepare(
      "INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('operation_window_expires_at', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).bind(input.expiresAt, updatedAt, input.actor),
  ];
  await runCubelicMutation(db, statements, [audit]);
}

export async function closeCubelicOperationWindowAndStop(
  db: D1Database,
  actor: string,
  audit: AuditInput,
): Promise<void> {
  const updatedAt = nowIso();
  const statements = [
    db.prepare(
      "INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('emergency_stop', 'true', ?, ?) ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).bind(updatedAt, actor),
    db.prepare(
      "DELETE FROM cubelic_system_flags WHERE key IN ('operation_window_event_id', 'operation_window_expires_at')",
    ),
  ];
  await runCubelicMutation(db, statements, [audit]);
}

export async function createCubelicManualAuthority(
  db: D1Database,
  authority: ManualProductionAuthorityV1,
  audit: AuditInput,
): Promise<{ authorityId: string; createdAt: string }> {
  const authorityId = `auth_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const statement = db.prepare(
    `INSERT INTO cubelic_manual_authorities (
      authority_id, content_id, schema_version, attested_by, attested_at,
      rights_confirmed, privacy_review_completed, destination_url, link_validated, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, 1, ?)`,
  ).bind(
    authorityId,
    authority.content_id,
    authority.schema_version,
    authority.attested_by,
    authority.attested_at,
    authority.destination_url,
    createdAt,
  );
  await runCubelicMutation(db, [statement], [audit]);
  return { authorityId, createdAt };
}

export async function getCubelicManualAuthority(
  db: D1Database,
  contentId: string,
): Promise<ManualProductionAuthorityV1 | null> {
  const row = await db.prepare(
    `SELECT schema_version, content_id, attested_by, attested_at, destination_url
     FROM cubelic_manual_authorities WHERE content_id = ?`,
  ).bind(contentId).first<{
    schema_version: 'cubelic.manual-production-authority.v1';
    content_id: string;
    attested_by: string;
    attested_at: string;
    destination_url: string;
  }>();
  return row ? {
    schema_version: row.schema_version,
    content_id: row.content_id,
    source_type: 'manual',
    attested_by: row.attested_by,
    attested_at: row.attested_at,
    rights_confirmed: true,
    privacy_review_completed: true,
    destination_url: row.destination_url,
    link_validated: true,
  } : null;
}

export interface CubelicPublicationJob {
  jobId: string;
  draftId: string;
  operation: 'schedule' | 'publish';
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  authorizationKind: 'human_individual' | 'preapproved_template';
  policyId: string | null;
  authorizedBy: string;
  authorizedAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  postId: string | null;
  idempotencyKey: string;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicationJobRow {
  job_id: string;
  draft_id: string;
  operation: CubelicPublicationJob['operation'];
  status: CubelicPublicationJob['status'];
  authorization_kind: CubelicPublicationJob['authorizationKind'];
  policy_id: string | null;
  authorized_by: string;
  authorized_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  post_id: string | null;
  idempotency_key: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

function mapPublicationJob(row: PublicationJobRow): CubelicPublicationJob {
  return {
    jobId: row.job_id,
    draftId: row.draft_id,
    operation: row.operation,
    status: row.status,
    authorizationKind: row.authorization_kind,
    policyId: row.policy_id,
    authorizedBy: row.authorized_by,
    authorizedAt: row.authorized_at,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    postId: row.post_id,
    idempotencyKey: row.idempotency_key,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCubelicPublicationJob(
  db: D1Database,
  input: {
    draftId: string;
    operation: 'schedule' | 'publish';
    authorizationKind: 'human_individual' | 'preapproved_template';
    policyId?: string;
    authorizedBy: string;
    authorizedAt: string;
    scheduledAt?: string;
    idempotencyKey: string;
  },
  audit: AuditInput,
): Promise<CubelicPublicationJob> {
  const existing = await getCubelicPublicationJobByIdempotencyKey(db, input.idempotencyKey);
  if (existing) return existing;
  const jobId = `pub_${crypto.randomUUID()}`;
  const timestamp = nowIso();
  const status = input.operation === 'schedule' ? 'scheduled' : 'publishing';
  const statement = db.prepare(
    `INSERT INTO cubelic_publication_jobs (
      job_id, draft_id, operation, status, authorization_kind, policy_id,
      authorized_by, authorized_at, scheduled_at, published_at, post_id,
      idempotency_key, failure_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
  ).bind(
    jobId,
    input.draftId,
    input.operation,
    status,
    input.authorizationKind,
    input.policyId ?? null,
    input.authorizedBy,
    input.authorizedAt,
    input.scheduledAt ?? null,
    input.idempotencyKey,
    timestamp,
    timestamp,
  );
  await runCubelicMutation(db, [statement], [audit]);
  const created = await getCubelicPublicationJob(db, jobId);
  if (!created) throw new Error('Publication job was not persisted');
  return created;
}

export async function getCubelicPublicationJob(
  db: D1Database,
  jobId: string,
): Promise<CubelicPublicationJob | null> {
  const row = await db.prepare('SELECT * FROM cubelic_publication_jobs WHERE job_id = ?')
    .bind(jobId).first<PublicationJobRow>();
  return row ? mapPublicationJob(row) : null;
}

export async function getCubelicPublicationJobByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<CubelicPublicationJob | null> {
  const row = await db.prepare('SELECT * FROM cubelic_publication_jobs WHERE idempotency_key = ?')
    .bind(idempotencyKey).first<PublicationJobRow>();
  return row ? mapPublicationJob(row) : null;
}

export async function completeCubelicPublicationJob(
  db: D1Database,
  input: { jobId: string; postId: string; publishedAt: string },
  audit: AuditInput,
): Promise<CubelicPublicationJob> {
  const statement = db.prepare(
    "UPDATE cubelic_publication_jobs SET status = 'published', post_id = ?, published_at = ?, updated_at = ? WHERE job_id = ? AND status IN ('publishing','scheduled')",
  ).bind(input.postId, input.publishedAt, nowIso(), input.jobId);
  await runCubelicMutation(db, [statement], [audit]);
  const updated = await getCubelicPublicationJob(db, input.jobId);
  if (!updated || updated.status !== 'published') throw new Error('Publication job could not be completed');
  return updated;
}

export async function checkCubelicPublicationRate(
  db: D1Database,
  input: { effectiveAt: string; excludeJobId?: string },
): Promise<{ allowed: true } | { allowed: false; reason: 'daily_limit' | 'weekly_limit' | 'minimum_interval' }> {
  const exclude = input.excludeJobId ?? '';
  const [day, week, interval] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count FROM cubelic_publication_jobs
       WHERE status IN ('scheduled','publishing','published') AND job_id <> ?
         AND date(CASE status
           WHEN 'published' THEN published_at
           WHEN 'publishing' THEN updated_at
           ELSE scheduled_at
         END, '+9 hours') = date(?, '+9 hours')`,
    ).bind(exclude, input.effectiveAt).first<{ count: number }>(),
    db.prepare(
      `SELECT EXISTS (
         SELECT 1
         FROM (
           SELECT CASE status
             WHEN 'published' THEN published_at
             WHEN 'publishing' THEN updated_at
             ELSE scheduled_at
           END AS window_start
           FROM cubelic_publication_jobs
           WHERE status IN ('scheduled','publishing','published') AND job_id <> ?
             AND julianday(CASE status
               WHEN 'published' THEN published_at
               WHEN 'publishing' THEN updated_at
               ELSE scheduled_at
             END) > julianday(?, '-7 days')
             AND julianday(CASE status
               WHEN 'published' THEN published_at
               WHEN 'publishing' THEN updated_at
               ELSE scheduled_at
             END) <= julianday(?)
           UNION
           SELECT ?
         ) AS candidate_starts
         WHERE (
           SELECT COUNT(*) FROM cubelic_publication_jobs AS counted
           WHERE counted.status IN ('scheduled','publishing','published')
             AND counted.job_id <> ?
             AND julianday(CASE counted.status
               WHEN 'published' THEN counted.published_at
               WHEN 'publishing' THEN counted.updated_at
               ELSE counted.scheduled_at
             END) >= julianday(candidate_starts.window_start)
             AND julianday(CASE counted.status
               WHEN 'published' THEN counted.published_at
               WHEN 'publishing' THEN counted.updated_at
               ELSE counted.scheduled_at
             END) < julianday(candidate_starts.window_start, '+7 days')
         ) >= 10
       ) AS blocked`,
    ).bind(
      exclude,
      input.effectiveAt,
      input.effectiveAt,
      input.effectiveAt,
      exclude,
    ).first<{ blocked: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM cubelic_publication_jobs
       WHERE status IN ('scheduled','publishing','published') AND job_id <> ?
         AND ABS((julianday(CASE status
           WHEN 'published' THEN published_at
           WHEN 'publishing' THEN updated_at
           ELSE scheduled_at
         END) - julianday(?)) * 1440) < 240`,
    ).bind(exclude, input.effectiveAt).first<{ count: number }>(),
  ]);
  if (Number(day?.count ?? 0) >= 2) return { allowed: false, reason: 'daily_limit' };
  if (Number(week?.blocked ?? 0) === 1) return { allowed: false, reason: 'weekly_limit' };
  if (Number(interval?.count ?? 0) > 0) return { allowed: false, reason: 'minimum_interval' };
  return { allowed: true };
}

export async function listDueCubelicPublicationJobs(
  db: D1Database,
  at: string,
  limit = 10,
): Promise<CubelicPublicationJob[]> {
  const result = await db.prepare(
    `SELECT * FROM cubelic_publication_jobs
     WHERE operation = 'schedule' AND status = 'scheduled' AND datetime(scheduled_at) <= datetime(?)
     ORDER BY datetime(scheduled_at) ASC
     LIMIT ?`,
  ).bind(at, limit).all<PublicationJobRow>();
  return result.results.map(mapPublicationJob);
}

export async function claimCubelicPublicationJob(
  db: D1Database,
  jobId: string,
  audit: AuditInput,
  at = nowIso(),
): Promise<boolean> {
  const claimToken = `claim_${crypto.randomUUID()}`;
  const timestamp = at;
  const statement = db.prepare(
    `UPDATE cubelic_publication_jobs
     SET status = 'publishing', claim_token = ?, updated_at = ?
     WHERE job_id = ? AND status = 'scheduled'
       AND (
         SELECT COUNT(*) FROM cubelic_publication_jobs AS existing
         WHERE existing.status IN ('publishing','published') AND existing.job_id <> ?
           AND date(CASE existing.status
             WHEN 'published' THEN existing.published_at
             ELSE existing.updated_at
           END, '+9 hours') = date(?, '+9 hours')
       ) < 2
       AND NOT EXISTS (
         SELECT 1
         FROM (
           SELECT CASE existing.status
             WHEN 'published' THEN existing.published_at
             ELSE existing.updated_at
           END AS window_start
           FROM cubelic_publication_jobs AS existing
           WHERE existing.status IN ('publishing','published') AND existing.job_id <> ?
             AND julianday(CASE existing.status
               WHEN 'published' THEN existing.published_at
               ELSE existing.updated_at
             END) > julianday(?, '-7 days')
             AND julianday(CASE existing.status
               WHEN 'published' THEN existing.published_at
               ELSE existing.updated_at
             END) <= julianday(?)
           UNION
           SELECT ?
         ) AS candidate_starts
         WHERE (
           SELECT COUNT(*) FROM cubelic_publication_jobs AS counted
           WHERE counted.status IN ('publishing','published') AND counted.job_id <> ?
             AND julianday(CASE counted.status
               WHEN 'published' THEN counted.published_at
               ELSE counted.updated_at
             END) >= julianday(candidate_starts.window_start)
             AND julianday(CASE counted.status
               WHEN 'published' THEN counted.published_at
               ELSE counted.updated_at
             END) < julianday(candidate_starts.window_start, '+7 days')
         ) >= 10
       )
       AND NOT EXISTS (
         SELECT 1 FROM cubelic_publication_jobs AS existing
         WHERE existing.status IN ('publishing','published') AND existing.job_id <> ?
           AND ABS((julianday(CASE existing.status
             WHEN 'published' THEN existing.published_at
             ELSE existing.updated_at
           END) - julianday(?)) * 1440) < 240
       )`,
  ).bind(
    claimToken,
    timestamp,
    jobId,
    jobId,
    at,
    jobId,
    at,
    at,
    at,
    jobId,
    jobId,
    at,
  );
  const conditionalAudit = db.prepare(
    `INSERT INTO cubelic_audit_logs (
      audit_id, actor, action, entity_type, entity_id, before_json, after_json,
      timestamp, correlation_id
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM cubelic_publication_jobs
      WHERE job_id = ? AND claim_token = ?
    )`,
  ).bind(
    `aud_${crypto.randomUUID()}`,
    audit.actor,
    audit.action,
    audit.entityType,
    audit.entityId,
    JSON.stringify(audit.before),
    JSON.stringify(audit.after),
    timestamp,
    audit.correlationId,
    jobId,
    claimToken,
  );
  await db.batch([statement, conditionalAudit]);
  const row = await db.prepare(
    'SELECT claim_token FROM cubelic_publication_jobs WHERE job_id = ?',
  ).bind(jobId).first<{ claim_token: string | null }>();
  return row?.claim_token === claimToken;
}

export async function failCubelicPublicationJob(
  db: D1Database,
  input: { jobId: string; failureCode: string },
  audit: AuditInput,
): Promise<void> {
  const statement = db.prepare(
    "UPDATE cubelic_publication_jobs SET status = 'failed', failure_code = ?, updated_at = ? WHERE job_id = ? AND status = 'publishing'",
  ).bind(input.failureCode, nowIso(), input.jobId);
  await runCubelicMutation(db, [statement], [audit]);
}

export interface PublishedPostMapping {
  schema_version: 'cubelic.published-post-mapping.v1';
  post_id: string;
  draft_id: string;
  published_at: string;
  source: 'manual';
  created_by: string;
  created_at: string;
}

export async function createCubelicPublishedPostMapping(
  db: D1Database,
  input: { postId: string; draftId: string; publishedAt: string; createdBy: string },
  audit: AuditInput,
): Promise<PublishedPostMapping> {
  const createdAt = nowIso();
  const statement = db.prepare(
    "INSERT INTO cubelic_post_mappings (post_id, draft_id, published_at, source, created_by, created_at) VALUES (?, ?, ?, 'manual', ?, ?)",
  ).bind(input.postId, input.draftId, input.publishedAt, input.createdBy, createdAt);
  await runCubelicMutation(db, [statement], [audit]);
  return {
    schema_version: 'cubelic.published-post-mapping.v1',
    post_id: input.postId,
    draft_id: input.draftId,
    published_at: input.publishedAt,
    source: 'manual',
    created_by: input.createdBy,
    created_at: createdAt,
  };
}

export async function getCubelicPublishedPostMapping(db: D1Database, postId: string): Promise<PublishedPostMapping | null> {
  const row = await db.prepare('SELECT post_id, draft_id, published_at, source, created_by, created_at FROM cubelic_post_mappings WHERE post_id = ?')
    .bind(postId).first<{
      post_id: string; draft_id: string; published_at: string; source: 'manual'; created_by: string; created_at: string;
    }>();
  return row ? {
    schema_version: 'cubelic.published-post-mapping.v1',
    post_id: row.post_id,
    draft_id: row.draft_id,
    published_at: row.published_at,
    source: row.source,
    created_by: row.created_by,
    created_at: row.created_at,
  } : null;
}

export async function saveCubelicMetrics(db: D1Database, input: { postId: string; window: '2h' | '24h' | '72h' | '7d'; values: PostMetrics; collectedAt: string }, audit: AuditInput): Promise<void> {
  const statement = db.prepare(
    'INSERT INTO cubelic_metrics (metric_id, post_id, collected_at, window, values_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(post_id, window) DO UPDATE SET collected_at = excluded.collected_at, values_json = excluded.values_json',
  ).bind(`met_${crypto.randomUUID()}`, input.postId, input.collectedAt, input.window, JSON.stringify(input.values));
  await runCubelicMutation(db, [statement], [audit]);
}

export async function getCubelicMetricsSnapshot(
  db: D1Database,
  postId: string,
  window: '2h' | '24h' | '72h' | '7d',
): Promise<{ postId: string; window: string; values: PostMetrics; collectedAt: string } | null> {
  const row = await db.prepare('SELECT post_id, window, values_json, collected_at FROM cubelic_metrics WHERE post_id = ? AND window = ?')
    .bind(postId, window).first<{ post_id: string; window: string; values_json: string; collected_at: string }>();
  return row ? { postId: row.post_id, window: row.window, values: json<PostMetrics>(row.values_json), collectedAt: row.collected_at } : null;
}

export async function getCubelicMetricsSummary(db: D1Database): Promise<Array<{
  postId: string;
  draftId: string;
  window: string;
  values: PostMetrics;
  collectedAt: string;
  dimensions: {
    category: DraftCandidate['category'];
    memberIds: string[];
    songIds: string[];
    eventId: string | null;
    targetStage: DraftCandidate['target_stage'];
    templateId: string;
    variant: DraftCandidate['variant'];
    emotionTags: string[];
    publishedAt: string;
  };
}>> {
  const result = await db.prepare(`
    SELECT m.post_id, m.window, m.values_json, m.collected_at,
      p.draft_id, p.published_at, d.category, d.target_stage, d.template_id, d.variant,
      d.emotion_tags, c.member_ids, c.song_ids, c.event_id
    FROM cubelic_metrics m
    JOIN cubelic_post_mappings p ON p.post_id = m.post_id
    JOIN cubelic_draft_posts d ON d.draft_id = p.draft_id
    JOIN cubelic_content_items c ON c.content_id = d.content_id
    ORDER BY m.collected_at DESC
  `).all<{
    post_id: string; window: string; values_json: string; collected_at: string; draft_id: string; published_at: string;
    category: DraftCandidate['category']; target_stage: DraftCandidate['target_stage']; template_id: string; variant: DraftCandidate['variant'];
    emotion_tags: string; member_ids: string; song_ids: string; event_id: string | null;
  }>();
  return result.results.map((row) => ({
    postId: row.post_id,
    draftId: row.draft_id,
    window: row.window,
    values: json<PostMetrics>(row.values_json),
    collectedAt: row.collected_at,
    dimensions: {
      category: row.category,
      memberIds: json<string[]>(row.member_ids),
      songIds: json<string[]>(row.song_ids),
      eventId: row.event_id,
      targetStage: row.target_stage,
      templateId: row.template_id,
      variant: row.variant,
      emotionTags: json<string[]>(row.emotion_tags),
      publishedAt: row.published_at,
    },
  }));
}
