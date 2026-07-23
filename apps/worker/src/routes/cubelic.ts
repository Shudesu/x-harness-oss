import { Hono, type Context } from 'hono';
import {
  ContentPolicyError,
  PublicationPolicyError,
  authorizeManualProductionInput,
  assertDraftableEventState,
  assertDraftApprovalGates,
  assertEventTransition,
  assertMediaPath,
  assertSha256,
  evaluateRights,
  generateSetlistDrafts,
  generateVideoDrafts,
  isDuplicateText,
  isRejectReason,
  validatePostText,
  type ContentItem,
  type DraftCandidate,
  type EventRecord,
  type RejectReason,
} from '@x-harness/content-os';
import {
  appendCubelicAudit,
  closeCubelicOperationWindowAndStop,
  createCubelicContent,
  createCubelicDrafts,
  createCubelicEvent,
  createCubelicMedia,
  createCubelicManualAuthority,
  createCubelicPublishedPostMapping,
  createCubelicSetlist,
  findCubelicMediaByHash,
  getCubelicContent,
  getCubelicDraft,
  getCubelicEmergencyStop,
  getCubelicEvent,
  getCubelicInertDraft,
  getCubelicMedia,
  getCubelicManualAuthority,
  getCubelicMetricsSummary,
  getCubelicMetricsSnapshot,
  getCubelicOperationWindow,
  getCubelicMemberMasterEntry,
  getCubelicPublishedPostMapping,
  getCubelicRejectionSummary,
  getCubelicSongMasterEntry,
  getCubelicSetlistForEvent,
  handoffCubelicDraftAndStop,
  listCubelicContent,
  listCubelicDrafts,
  listCubelicEvents,
  saveCubelicMetrics,
  recordCubelicRejections,
  reserveCubelicDraftApproval,
  setCubelicDraftDecision,
  setCubelicEmergencyStop,
  setCubelicOperationWindow,
  upsertCubelicMemberMaster,
  upsertCubelicSongMaster,
  updateCubelicContent,
  updateCubelicDraftText,
  updateCubelicEvent,
  updateCubelicMediaReview,
  validateCubelicSetlistSongs,
  validateCubelicContentReferences,
} from '@x-harness/db';
import { buildCubelicPhase3XAdapter, buildCubelicXAdapter } from '../cubelic/adapter.js';
import { isPhase3PublicationEnabled } from '../cubelic/safety.js';
import { parseContent, parseEvent, parseMedia, parseMemberMaster, parseSetlist, parseSongMaster } from '../cubelic/validation.js';
import type { Env } from '../index.js';

export const cubelic = new Hono<Env>();
const DUPLICATE_WINDOW_MS = 72 * 60 * 60_000;

function correlationId(c: Context<Env>): string {
  const existing = c.get('correlationId');
  if (existing) return existing;
  const value = c.req.header('X-Correlation-Id') || crypto.randomUUID();
  c.set('correlationId', value);
  return value;
}

function actor(c: Context<Env>): 'human' | 'hermes' {
  return c.get('requestActor') === 'hermes' ? 'hermes' : 'human';
}

function actorName(c: Context<Env>): string {
  return c.get('staffName') || actor(c);
}

function rejectionInput(c: Context<Env>, reasons: RejectReason[]) {
  return {
    actor: actor(c),
    reasons,
    requestMethod: c.req.method,
    requestPath: new URL(c.req.url).pathname,
    correlationId: correlationId(c),
  } as const;
}

function eventAuditSnapshot(event: EventRecord): Record<string, unknown> {
  return {
    event_id: event.event_id,
    title: event.title,
    venue: event.venue,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    state: event.state,
    official_url: event.official_url ?? null,
    ticket_url: event.ticket_url ?? null,
    event_tags: event.event_tags,
    filming_policy: {
      confirmed: event.filming_policy.confirmed,
      scope: event.filming_policy.scope,
      evidence_type: event.filming_policy.evidence_type,
      evidence_url_present: Boolean(event.filming_policy.evidence_url),
      confirmed_at: event.filming_policy.confirmed_at,
      confirmed_by_present: Boolean(event.filming_policy.confirmed_by),
      notes_present: Boolean(event.filming_policy.notes),
    },
  };
}

function contentAuditSnapshot(content: ContentItem): Record<string, unknown> {
  return {
    content_id: content.content_id,
    event_id: content.event_id,
    category: content.category,
    target_stage: content.target_stage,
    content_lifecycle: content.content_lifecycle,
    status: content.status,
    source_type: content.source_type,
    source_refs: content.source_refs,
    member_ids: content.member_ids,
    song_ids: content.song_ids,
    emotion_tags: content.emotion_tags,
    destination: content.destination,
    created_at: content.created_at,
    updated_at: content.updated_at,
  };
}

function mediaAuditSnapshot(media: ReturnType<typeof parseMedia>, rejectReasons: RejectReason[]): Record<string, unknown> {
  return {
    asset_id: media.asset_id,
    event_id: media.event_id,
    sha256: media.sha256,
    duration_seconds: media.duration_seconds,
    orientation: media.orientation,
    resolution: media.resolution,
    audio_present: media.audio_present,
    rights: {
      filming_policy_confirmed: media.rights.filming_policy_confirmed,
      song_scope_confirmed: media.rights.song_scope_confirmed,
      publishing_allowed: media.rights.publishing_allowed,
      evidence_url_present: Boolean(media.rights.evidence_url),
    },
    privacy: media.privacy,
    quality: media.quality,
    status: media.status,
    reject_reasons: rejectReasons,
  };
}

async function draftAuditSnapshot(draft: DraftCandidate): Promise<Record<string, unknown>> {
  return {
    draft_id: draft.draft_id,
    content_id: draft.content_id,
    account_id: draft.account_id,
    text_sha256: await sha256Json(draft.text),
    media_asset_ids: draft.media_asset_ids,
    category: draft.category,
    template_id: draft.template_id,
    template_version: draft.template_version,
    variant: draft.variant,
    target_stage: draft.target_stage,
    emotion_tags: draft.emotion_tags,
    hashtags: draft.hashtags,
    destination_url: draft.destination_url,
    utm: draft.utm,
    quality_score: draft.quality_score,
    quality_breakdown: draft.quality_breakdown,
    freshness_score: draft.freshness_score,
    rights_gate: draft.rights_gate,
    approval_status: draft.approval_status,
    risks: draft.risks.map((risk) => risk.includes('証跡:') ? 'evidence_reference_present' : risk),
    human_review_required: draft.human_review_required,
    idempotency_key: draft.idempotency_key,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

async function persistRejectReasons(c: Context<Env>, reasons: RejectReason[]): Promise<void> {
  if (reasons.length === 0) return;
  await recordCubelicRejections(c.env.DB, rejectionInput(c, reasons));
}

async function apiError(c: Context<Env>, error: unknown): Promise<Response> {
  const path = new URL(c.req.url).pathname;
  const entityId = path.match(/^\/api\/cubelic\/(?:events|content|media|drafts|x-harness-inbox)\/([^/]+)/)?.[1];
  if (error instanceof ContentPolicyError) {
    try {
      await persistRejectReasons(c, error.rejectReasons);
    } catch (persistenceError) {
      console.error('cubelic_request_failed', {
        correlation_id: correlationId(c), actor: actor(c), outcome: 'error', error_code: 'rejection_persistence_failed',
        entity_id: entityId, error_type: persistenceError instanceof Error ? persistenceError.name : 'unknown',
      });
      return c.json({ success: false, error: 'Request failed', code: 'internal_error' }, 500);
    }
    console.error('cubelic_request_rejected', {
      correlation_id: correlationId(c), actor: actor(c), outcome: 'rejected', error_code: error.code, entity_id: entityId,
    });
    return c.json({ success: false, error: error.message, code: error.code, rejectReasons: error.rejectReasons }, 422);
  }
  if (error instanceof PublicationPolicyError) {
    const stopped = ['phase3_operation_disabled', 'emergency_stop_active'].includes(error.code);
    const forbidden = ['human_publication_required', 'publication_operator_mismatch'].includes(error.code);
    console.error('cubelic_publication_rejected', {
      correlation_id: correlationId(c),
      actor: actor(c),
      outcome: 'rejected',
      error_code: error.code,
      entity_id: entityId,
    });
    return c.json(
      { success: false, error: error.message, code: error.code },
      stopped ? 423 : forbidden ? 403 : 422,
    );
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (message.includes('UNIQUE constraint failed')) {
    console.error('cubelic_request_rejected', {
      correlation_id: correlationId(c), actor: actor(c), outcome: 'conflict', error_code: 'conflict', entity_id: entityId,
    });
    return c.json({ success: false, error: 'Resource already exists', code: 'conflict' }, 409);
  }
  console.error('cubelic_request_failed', {
    correlation_id: correlationId(c), actor: actor(c), outcome: 'error', error_code: 'internal_error',
    entity_id: entityId, error_type: error instanceof Error ? error.name : 'unknown',
  });
  return c.json({ success: false, error: 'Request failed', code: 'internal_error' }, 500);
}

async function sha256Json(value: unknown): Promise<string> {
  const input = JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function assertNoStoredDuplicate(db: D1Database, drafts: DraftCandidate[]): Promise<void> {
  const contentId = drafts[0]?.content_id;
  const recentTexts = await recentOtherDraftTexts(db, contentId);
  const duplicate = drafts.find((draft) => isDuplicateText(draft.text, recentTexts));
  if (duplicate) {
    throw new ContentPolicyError('duplicate_content', 'Generated draft is too similar to stored content', ['duplicate_content']);
  }
}

async function recentOtherDraftTexts(db: D1Database, contentId: string | undefined): Promise<string[]> {
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
  return (await listCubelicDrafts(db))
    .filter((draft) => draft.content_id !== contentId && Date.parse(draft.created_at) >= cutoff)
    .map((draft) => draft.text);
}

async function assertCanonicalContentReferences(db: D1Database, content: ContentItem): Promise<void> {
  const result = await validateCubelicContentReferences(db, { songIds: content.song_ids, memberIds: content.member_ids });
  const reasons: RejectReason[] = [];
  if (result.unknownSongIds.length > 0) reasons.push('song_unknown');
  if (result.unknownMemberIds.length > 0) reasons.push('member_unknown');
  if (reasons.length > 0) {
    throw new ContentPolicyError(
      'content_reference_unknown',
      `Unknown or inactive content references: songs=${result.unknownSongIds.join(',') || 'none'}; members=${result.unknownMemberIds.join(',') || 'none'}`,
      reasons,
    );
  }
}

function isMetricsWrite(path: string): boolean {
  return path === '/api/cubelic/metrics/collect';
}

function isEmergencyAdmin(path: string): boolean {
  return path === '/api/cubelic/admin/emergency-stop'
    || path === '/api/cubelic/admin/emergency-resume'
    || path === '/api/cubelic/admin/operation-window';
}

const OPERATION_WINDOW_UNSCOPED_WRITES = new Set([
  '/api/cubelic/masters/songs/ingest',
  '/api/cubelic/masters/members/ingest',
]);

async function operationEventForWrite(c: Context<Env>, path: string): Promise<string | null | undefined> {
  if (OPERATION_WINDOW_UNSCOPED_WRITES.has(path)) return undefined;
  const payload = async () => c.req.raw.clone().json() as Promise<Record<string, unknown>>;
  if (path === '/api/cubelic/events' || path === '/api/cubelic/content' || path === '/api/cubelic/media/validate' || path === '/api/cubelic/setlists/ingest') {
    const body = await payload();
    return typeof body.event_id === 'string' ? body.event_id : null;
  }
  if (path === '/api/cubelic/rights/validate') {
    const body = await payload();
    return typeof body.eventId === 'string' ? body.eventId : null;
  }
  const eventPath = path.match(/^\/api\/cubelic\/events\/([^/]+)$/);
  if (eventPath) return decodeURIComponent(eventPath[1]);
  const contentPath = path.match(/^\/api\/cubelic\/content\/([^/]+)$/);
  if (contentPath) return (await getCubelicContent(c.env.DB, decodeURIComponent(contentPath[1])))?.event_id ?? null;
  const mediaPath = path.match(/^\/api\/cubelic\/media\/([^/]+)\/review$/);
  if (mediaPath) return (await getCubelicMedia(c.env.DB, decodeURIComponent(mediaPath[1])))?.event_id ?? null;
  if (path === '/api/cubelic/drafts/generate') {
    const body = await payload();
    if (typeof body.contentId !== 'string') return null;
    return (await getCubelicContent(c.env.DB, body.contentId))?.event_id ?? null;
  }
  const draftPath = path.match(/^\/api\/cubelic\/drafts\/([^/]+)(?:\/(?:approve|reject))?$/);
  if (draftPath) {
    const draft = await getCubelicDraft(c.env.DB, decodeURIComponent(draftPath[1]));
    return draft ? (await getCubelicContent(c.env.DB, draft.content_id))?.event_id ?? null : null;
  }
  if (path === '/api/cubelic/metrics/post-mappings') {
    const body = await payload();
    if (typeof body.draftId !== 'string') return null;
    const draft = await getCubelicDraft(c.env.DB, body.draftId);
    return draft ? (await getCubelicContent(c.env.DB, draft.content_id))?.event_id ?? null : null;
  }
  return null;
}

function hermesClaimsHumanRights(event: EventRecord): boolean {
  const policy = event.filming_policy;
  return policy.confirmed
    || policy.confirmed_by !== null
    || policy.confirmed_at !== null
    || policy.evidence_type !== null
    || policy.evidence_url !== null;
}

function hermesClaimsHumanMediaReview(media: ReturnType<typeof parseMedia>): boolean {
  return media.rights.filming_policy_confirmed
    || media.rights.song_scope_confirmed
    || media.rights.publishing_allowed
    || Boolean(media.rights.evidence_url)
    || media.privacy.manual_review_completed;
}

async function requireHumanApproval(c: Context<Env>): Promise<Response | null> {
  if (actor(c) !== 'human' || !['admin', 'editor'].includes(c.get('staffRole') ?? '')) {
    return c.json({ success: false, error: 'Human admin/editor approval is required', code: 'human_approval_required' }, 403);
  }
  if (!c.env.HUMAN_APPROVAL_KEY) {
    return c.json({ success: false, error: 'Human approval secret is not configured', code: 'human_approval_not_configured' }, 503);
  }
  if (c.req.header('X-Human-Approval-Key') !== c.env.HUMAN_APPROVAL_KEY) {
    return c.json({ success: false, error: 'Human approval proof is invalid', code: 'human_approval_invalid' }, 403);
  }
  return null;
}

async function requireNamedHumanApproval(c: Context<Env>): Promise<Response | null> {
  const denied = await requireHumanApproval(c);
  if (denied) return denied;
  if (!c.get('staffId') || !c.get('staffName')) {
    return c.json({
      success: false,
      error: 'A named staff credential is required for Phase 3 publication authority',
      code: 'named_human_required',
    }, 403);
  }
  return null;
}

function namedHumanId(c: Context<Env>): string {
  const staffId = c.get('staffId');
  if (!staffId) throw new PublicationPolicyError('named_human_required', 'A named staff identity is required');
  return staffId;
}

cubelic.use('/api/cubelic/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);
  if (!write || isMetricsWrite(path) || isEmergencyAdmin(path)) return next();
  const envStopped = c.env.GLOBAL_PUBLISHING_DISABLED !== 'false';
  const dbStopped = await getCubelicEmergencyStop(c.env.DB);
  if (envStopped || dbStopped) {
    return c.json({ success: false, error: 'Emergency stop is active', code: 'emergency_stop_active', source: envStopped ? 'environment' : 'database' }, 423);
  }
  if (isPhase3PublicationEnabled(c.env)) return next();
  const operationWindow = await getCubelicOperationWindow(c.env.DB);
  if (operationWindow && !operationWindow.active) {
    await closeCubelicOperationWindowAndStop(c.env.DB, 'system', { actor: 'system', action: 'system.operation_window_expired', entityType: 'system', entityId: 'operation_window', before: { eventId: operationWindow.eventId, expiresAt: operationWindow.expiresAt }, after: { stopped: true }, correlationId: correlationId(c) });
    return c.json({ success: false, error: 'The production operation window expired', code: 'operation_window_expired' }, 423);
  }
  if (!operationWindow) {
    return c.json({ success: false, error: 'A valid production operation window is required', code: 'operation_window_inactive' }, 423);
  }
  const requestEventId = await operationEventForWrite(c, path);
  if (requestEventId !== undefined && requestEventId !== operationWindow.eventId) {
    return c.json({ success: false, error: 'The active operation window is bound to another event', code: 'operation_event_mismatch' }, 423);
  }
  return next();
});

cubelic.post('/api/cubelic/events', async (c) => {
  try {
    const event = parseEvent(await c.req.json());
    if (actor(c) === 'hermes' && hermesClaimsHumanRights(event)) {
      await persistRejectReasons(c, ['rights_unconfirmed']);
      return c.json({ success: false, error: 'Hermes cannot assert human-confirmed filming rights', code: 'human_rights_review_required' }, 403);
    }
    if (hermesClaimsHumanRights(event)) {
      const denied = await requireHumanApproval(c);
      if (denied) {
        await persistRejectReasons(c, ['rights_unconfirmed']);
        return denied;
      }
    }
    await createCubelicEvent(c.env.DB, event, { actor: actor(c), action: 'event.created', entityType: 'event', entityId: event.event_id, before: {}, after: eventAuditSnapshot(event), correlationId: correlationId(c) });
    return c.json({ success: true, data: event }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.get('/api/cubelic/events', async (c) => c.json({ success: true, data: await listCubelicEvents(c.env.DB) }));

cubelic.get('/api/cubelic/events/:id', async (c) => {
  const event = await getCubelicEvent(c.env.DB, c.req.param('id'));
  return event ? c.json({ success: true, data: event }) : c.json({ success: false, error: 'Event not found' }, 404);
});

cubelic.patch('/api/cubelic/events/:id', async (c) => {
  try {
    const existing = await getCubelicEvent(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Event not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const merged = parseEvent({ ...existing, ...body, event_id: existing.event_id });
    const rightsChanged = JSON.stringify(existing.filming_policy) !== JSON.stringify(merged.filming_policy);
    if (rightsChanged && hermesClaimsHumanRights(merged)) {
      const denied = await requireHumanApproval(c);
      if (denied) {
        await persistRejectReasons(c, ['rights_unconfirmed']);
        return denied;
      }
    }
    assertEventTransition(existing.state, merged.state);
    await updateCubelicEvent(c.env.DB, merged, { actor: actor(c), action: 'event.updated', entityType: 'event', entityId: existing.event_id, before: eventAuditSnapshot(existing), after: eventAuditSnapshot(merged), correlationId: correlationId(c) });
    return c.json({ success: true, data: merged });
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/content', async (c) => {
  try {
    const content = parseContent(await c.req.json());
    if (content.event_id && !(await getCubelicEvent(c.env.DB, content.event_id))) {
      throw new ContentPolicyError('event_unknown', 'Referenced event does not exist', ['event_unknown']);
    }
    await assertCanonicalContentReferences(c.env.DB, content);
    await createCubelicContent(c.env.DB, content, { actor: actor(c), action: 'content.created', entityType: 'content', entityId: content.content_id, before: {}, after: contentAuditSnapshot(content), correlationId: correlationId(c) });
    return c.json({ success: true, data: content }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.get('/api/cubelic/content', async (c) => c.json({ success: true, data: await listCubelicContent(c.env.DB) }));

cubelic.get('/api/cubelic/content/:id', async (c) => {
  const content = await getCubelicContent(c.env.DB, c.req.param('id'));
  return content ? c.json({ success: true, data: content }) : c.json({ success: false, error: 'Content item not found' }, 404);
});

cubelic.patch('/api/cubelic/content/:id', async (c) => {
  try {
    const existing = await getCubelicContent(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Content item not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const merged = parseContent({ ...existing, ...body, content_id: existing.content_id, created_at: existing.created_at });
    await assertCanonicalContentReferences(c.env.DB, merged);
    await updateCubelicContent(c.env.DB, merged, { actor: actor(c), action: 'content.updated', entityType: 'content', entityId: existing.content_id, before: contentAuditSnapshot(existing), after: contentAuditSnapshot(merged), correlationId: correlationId(c) });
    return c.json({ success: true, data: merged });
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/media/validate', async (c) => {
  try {
    const media = parseMedia(await c.req.json());
    if (actor(c) === 'hermes' && hermesClaimsHumanMediaReview(media)) {
      await persistRejectReasons(c, ['rights_unconfirmed']);
      return c.json({ success: false, error: 'Hermes cannot assert rights or privacy review completion', code: 'human_rights_review_required' }, 403);
    }
    if (hermesClaimsHumanMediaReview(media)) {
      const denied = await requireHumanApproval(c);
      if (denied) {
        await persistRejectReasons(c, ['rights_unconfirmed']);
        return denied;
      }
    }
    assertMediaPath(media.path);
    assertSha256(media.sha256);
    if (!['vertical', 'horizontal', 'square'].includes(media.orientation) || !/^\d+x\d+$/.test(media.resolution) || media.duration_seconds <= 0) {
      throw new ContentPolicyError('incorrect_metadata', 'Invalid media dimensions, orientation or duration', ['incorrect_metadata']);
    }
    const existing = await findCubelicMediaByHash(c.env.DB, media.sha256);
    if (existing) {
      await appendCubelicAudit(c.env.DB, { actor: actor(c), action: 'media.rejected', entityType: 'media', entityId: media.asset_id, before: {}, after: { reason: 'duplicate_media', existingAssetId: existing.asset_id }, correlationId: correlationId(c) });
      await persistRejectReasons(c, ['duplicate_media']);
      return c.json({ success: false, error: 'Duplicate media', code: 'duplicate_media', rejectReasons: ['duplicate_media'], data: { existingAssetId: existing.asset_id } }, 409);
    }
    const event = await getCubelicEvent(c.env.DB, media.event_id);
    if (!event) throw new ContentPolicyError('event_unknown', 'Referenced event does not exist', ['event_unknown']);
    const rights = evaluateRights(event, media);
    media.status = rights.passed ? 'approved_for_draft' : 'blocked';
    await createCubelicMedia(
      c.env.DB,
      media,
      rights.rejectReasons,
      { actor: actor(c), action: rights.passed ? 'media.validated' : 'media.blocked', entityType: 'media', entityId: media.asset_id, before: {}, after: mediaAuditSnapshot(media, rights.rejectReasons), correlationId: correlationId(c) },
      rights.passed ? undefined : rejectionInput(c, rights.rejectReasons),
    );
    return c.json({ success: rights.passed, data: { media, rejectReasons: rights.rejectReasons, reviewFlags: rights.reviewFlags } }, rights.passed ? 201 : 422);
  } catch (error) { return apiError(c, error); }
});

cubelic.patch('/api/cubelic/media/:id/review', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    const existing = await getCubelicMedia(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Media asset not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (Object.keys(body).some((key) => !['rights', 'privacy'].includes(key))) {
      throw new ContentPolicyError('invalid_request', 'Only rights and privacy may be changed during human media review', ['incorrect_metadata']);
    }
    const reviewed = parseMedia({ ...existing, rights: body.rights ?? existing.rights, privacy: body.privacy ?? existing.privacy });
    const event = await getCubelicEvent(c.env.DB, reviewed.event_id);
    if (!event) throw new ContentPolicyError('event_unknown', 'Referenced event does not exist', ['event_unknown']);
    const rights = evaluateRights(event, reviewed);
    reviewed.status = rights.passed ? 'approved_for_draft' : 'blocked';
    await updateCubelicMediaReview(c.env.DB, reviewed, rights.rejectReasons, {
      actor: 'human',
      action: 'media.human_reviewed',
      entityType: 'media',
      entityId: reviewed.asset_id,
      before: mediaAuditSnapshot(existing, []),
      after: mediaAuditSnapshot(reviewed, rights.rejectReasons),
      correlationId: correlationId(c),
    }, rights.passed ? undefined : rejectionInput(c, rights.rejectReasons));
    return c.json({ success: rights.passed, data: { media: reviewed, rejectReasons: rights.rejectReasons } }, rights.passed ? 200 : 422);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/rights/validate', async (c) => {
  try {
    const body = await c.req.json<{ eventId?: string; assetId?: string }>();
    if (!body.eventId || !body.assetId) throw new ContentPolicyError('invalid_request', 'eventId and assetId are required', ['incorrect_metadata']);
    const [event, media] = await Promise.all([getCubelicEvent(c.env.DB, body.eventId), getCubelicMedia(c.env.DB, body.assetId)]);
    if (!event) throw new ContentPolicyError('event_unknown', 'Event not found', ['event_unknown']);
    if (!media) throw new ContentPolicyError('incorrect_metadata', 'Media not found', ['incorrect_metadata']);
    const result = evaluateRights(event, media);
    if (!result.passed) await persistRejectReasons(c, result.rejectReasons);
    return c.json({ success: result.passed, data: result }, result.passed ? 200 : 422);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/masters/songs/ingest', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    const master = parseSongMaster(await c.req.json());
    const count = master.songs.length;
    const previous = new Map((await Promise.all(master.songs.map((song) => getCubelicSongMasterEntry(c.env.DB, song.song_id)))).filter((song) => song !== null).map((song) => [song.song_id, song]));
    await upsertCubelicSongMaster(c.env.DB, master, master.songs.map((song) => ({ actor: 'human', action: 'song_master.upserted', entityType: 'song', entityId: song.song_id, before: previous.get(song.song_id) ?? {}, after: { ...song, source_generated_at: master.generated_at }, correlationId: correlationId(c) })));
    return c.json({ success: true, data: { count, generatedAt: master.generated_at } }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/masters/members/ingest', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    const master = parseMemberMaster(await c.req.json());
    const count = master.members.length;
    const previous = new Map((await Promise.all(master.members.map((member) => getCubelicMemberMasterEntry(c.env.DB, member.member_id)))).filter((member) => member !== null).map((member) => [member.member_id, member]));
    await upsertCubelicMemberMaster(c.env.DB, master, master.members.map((member) => ({ actor: 'human', action: 'member_master.upserted', entityType: 'member', entityId: member.member_id, before: previous.get(member.member_id) ?? {}, after: { ...member, source_generated_at: master.generated_at }, correlationId: correlationId(c) })));
    return c.json({ success: true, data: { count, generatedAt: master.generated_at } }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/setlists/ingest', async (c) => {
  try {
    const setlist = parseSetlist(await c.req.json());
    const event = await getCubelicEvent(c.env.DB, setlist.event_id);
    if (!event) throw new ContentPolicyError('event_unknown', 'Setlist event does not exist', ['event_unknown']);
    const songValidation = await validateCubelicSetlistSongs(c.env.DB, setlist.songs);
    if (songValidation.unknownSongIds.length > 0) {
      throw new ContentPolicyError('song_unknown', `Unknown or inactive song ids: ${songValidation.unknownSongIds.join(', ')}`, ['song_unknown']);
    }
    if (songValidation.titleMismatches.length > 0) {
      throw new ContentPolicyError('song_title_mismatch', `Song titles do not match the canonical master: ${songValidation.titleMismatches.join(', ')}`, ['incorrect_metadata']);
    }
    if (event.title !== setlist.event_title || event.venue !== setlist.venue || event.starts_at !== setlist.starts_at || event.ends_at !== setlist.ends_at) {
      throw new ContentPolicyError('incorrect_metadata', 'Setlist event title, venue, or timestamps do not match', ['incorrect_metadata']);
    }
    if (event.state === 'ended') {
      const advanced = { ...event, state: 'setlist_confirmed' as const };
      await updateCubelicEvent(c.env.DB, advanced, { actor: actor(c), action: 'event.state_advanced', entityType: 'event', entityId: event.event_id, before: eventAuditSnapshot(event), after: eventAuditSnapshot(advanced), correlationId: correlationId(c) });
      event.state = advanced.state;
    } else if (!['setlist_confirmed', 'digest_ready', 'archived'].includes(event.state)) {
      throw new ContentPolicyError('event_state_mismatch', 'Event must be ended before a setlist can be confirmed', ['event_unknown']);
    }
    const payloadHash = await sha256Json(setlist);
    const stored = await createCubelicSetlist(c.env.DB, setlist, payloadHash, (setlistId) => ({
      actor: actor(c),
      action: 'setlist.created',
      entityType: 'setlist',
      entityId: setlistId,
      before: {},
      after: {
        schema_version: setlist.schema_version,
        event_id: setlist.event_id,
        event_title: setlist.event_title,
        venue: setlist.venue,
        starts_at: setlist.starts_at,
        ends_at: setlist.ends_at,
        lp_url: setlist.lp_url,
        confirmed_at: setlist.confirmed_at,
        confirmed_by_present: Boolean(setlist.confirmed_by),
        songs: setlist.songs,
        payload_sha256: payloadHash,
      },
      correlationId: correlationId(c),
    }));
    const contentId = `cnt_setlist_${setlist.event_id}`;
    let content = await getCubelicContent(c.env.DB, contentId);
    if (!content) {
      content = parseContent({
        content_id: contentId,
        event_id: setlist.event_id,
        category: 'setlist_flash',
        target_stage: 'interested',
        content_lifecycle: { type: 'hybrid', expires_at: null },
        status: 'validated',
        source_type: 'setlist_json',
        source_refs: [stored.setlistId],
        member_ids: [],
        song_ids: setlist.songs.map((song) => song.song_id),
        emotion_tags: ['informative'],
        destination: { type: 'setlist_page', base_url: setlist.lp_url, tracked_url: '' },
      });
      await createCubelicContent(c.env.DB, content, { actor: actor(c), action: 'content.created_from_setlist', entityType: 'content', entityId: content.content_id, before: {}, after: { status: content.status, setlistId: stored.setlistId }, correlationId: correlationId(c) });
    }
    const existingDrafts = (await listCubelicDrafts(c.env.DB)).filter((draft) => draft.content_id === contentId);
    let drafts = existingDrafts;
    if (drafts.length === 0) {
      drafts = await generateSetlistDrafts({ setlist, content, event, now: new Date().toISOString() });
      await assertNoStoredDuplicate(c.env.DB, drafts);
      const draftAudits = await Promise.all(drafts.map(async (draft) => ({ actor: actor(c), action: 'draft.created', entityType: 'draft', entityId: draft.draft_id, before: {}, after: await draftAuditSnapshot(draft), correlationId: correlationId(c) })));
      drafts = await createCubelicDrafts(c.env.DB, drafts, draftAudits);
      const updatedContent = { ...content, status: 'draft_generated' as const, updated_at: new Date().toISOString() };
      await updateCubelicContent(c.env.DB, updatedContent, { actor: actor(c), action: 'content.drafts_generated', entityType: 'content', entityId: content.content_id, before: contentAuditSnapshot(content), after: contentAuditSnapshot(updatedContent), correlationId: correlationId(c) });
    }
    return c.json({ success: true, data: { ...stored, contentId, drafts } }, stored.idempotentReplay ? 200 : 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/drafts/generate', async (c) => {
  try {
    const body = await c.req.json<{ contentId?: string; mediaAssetId?: string }>();
    if (!body.contentId) throw new ContentPolicyError('invalid_request', 'contentId is required', ['incorrect_metadata']);
    const content = await getCubelicContent(c.env.DB, body.contentId);
    if (!content) throw new ContentPolicyError('incorrect_metadata', 'Content item not found', ['incorrect_metadata']);
    if (!content.event_id) throw new ContentPolicyError('event_unknown', 'Content has no event', ['event_unknown']);
    const event = await getCubelicEvent(c.env.DB, content.event_id);
    if (!event) throw new ContentPolicyError('event_unknown', 'Event not found', ['event_unknown']);
    const currentTime = new Date().toISOString();
    let drafts: DraftCandidate[];
    if (content.source_type === 'setlist_json') {
      const setlist = await getCubelicSetlistForEvent(c.env.DB, content.event_id);
      if (!setlist) throw new ContentPolicyError('incorrect_metadata', 'Setlist payload not found', ['incorrect_metadata']);
      drafts = await generateSetlistDrafts({ setlist, content, event, now: currentTime });
    } else {
      if (!body.mediaAssetId) throw new ContentPolicyError('invalid_request', 'mediaAssetId is required for video drafts', ['incorrect_metadata']);
      const media = await getCubelicMedia(c.env.DB, body.mediaAssetId);
      if (!media) throw new ContentPolicyError('incorrect_metadata', 'Media asset not found', ['incorrect_metadata']);
      if (media.event_id !== content.event_id) {
        throw new ContentPolicyError('incorrect_metadata', 'Media event does not match the content event', ['incorrect_metadata']);
      }
      drafts = await generateVideoDrafts({ content, event, media, now: currentTime });
    }
    await assertNoStoredDuplicate(c.env.DB, drafts);
    const draftAudits = await Promise.all(drafts.map(async (draft) => ({ actor: actor(c), action: 'draft.created', entityType: 'draft', entityId: draft.draft_id, before: {}, after: await draftAuditSnapshot(draft), correlationId: correlationId(c) })));
    drafts = await createCubelicDrafts(c.env.DB, drafts, draftAudits);
    const updatedContent = { ...content, status: 'draft_generated' as const, updated_at: currentTime };
    await updateCubelicContent(c.env.DB, updatedContent, { actor: actor(c), action: 'content.drafts_generated', entityType: 'content', entityId: content.content_id, before: contentAuditSnapshot(content), after: contentAuditSnapshot(updatedContent), correlationId: correlationId(c) });
    return c.json({ success: true, data: drafts }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/manual-drafts', async (c) => {
  try {
    if (!isPhase3PublicationEnabled(c.env)) {
      throw new PublicationPolicyError('phase3_operation_disabled', 'Phase 3 publication capability is disabled');
    }
    const denied = await requireNamedHumanApproval(c);
    if (denied) return denied;
    const body = await c.req.json<{
      text?: string;
      category?: 'event_notice' | 'event_reminder' | 'youtube_notice';
      destinationUrl?: string;
      rightsConfirmed?: boolean;
      privacyReviewCompleted?: boolean;
      linkValidated?: boolean;
    }>();
    if (!body.text || !body.category || !body.destinationUrl) {
      throw new PublicationPolicyError('manual_draft_invalid', 'text, category and destinationUrl are required');
    }
    if (!['event_notice', 'event_reminder', 'youtube_notice'].includes(body.category)) {
      throw new PublicationPolicyError('manual_category_not_allowed', 'Manual publication category is not allowed');
    }
    validatePostText(body.text);
    const now = new Date().toISOString();
    const identity = (await sha256Json({
      text: body.text,
      category: body.category,
      destinationUrl: body.destinationUrl,
      operator: namedHumanId(c),
    })).slice(0, 24);
    const contentId = `cnt_manual_${identity}`;
    const draftId = `drf_manual_${identity}`;
    const authority = authorizeManualProductionInput({
      contentId,
      attestedBy: namedHumanId(c),
      attestedAt: now,
      rightsConfirmed: body.rightsConfirmed === true,
      privacyReviewCompleted: body.privacyReviewCompleted === true,
      destinationUrl: body.destinationUrl,
      linkValidated: body.linkValidated === true,
    });
    const destination = new URL(body.destinationUrl);
    destination.searchParams.set('utm_source', 'x');
    destination.searchParams.set('utm_medium', 'social');
    destination.searchParams.set('utm_campaign', 'manual_phase3');
    destination.searchParams.set('utm_content', `${body.category}_manual_v1`);
    const content: ContentItem = {
      content_id: contentId,
      event_id: null,
      category: body.category,
      target_stage: 'interested',
      content_lifecycle: { type: 'news', expires_at: null },
      status: 'draft_generated',
      source_type: 'manual',
      source_refs: [`manual:${namedHumanId(c)}`],
      member_ids: [],
      song_ids: [],
      emotion_tags: ['informative'],
      destination: {
        type: 'manual_https',
        base_url: body.destinationUrl,
        tracked_url: destination.toString(),
      },
      created_at: now,
      updated_at: now,
    };
    const draft: DraftCandidate = {
      draft_id: draftId,
      content_id: contentId,
      account_id: 'tubelic_cube',
      text: body.text,
      media_asset_ids: [],
      category: body.category,
      template_id: `${body.category}_manual_v1`,
      template_version: '1.0.0',
      variant: 'a',
      target_stage: 'interested',
      emotion_tags: ['informative'],
      hashtags: [],
      destination_url: body.destinationUrl,
      utm: {
        source: 'x',
        medium: 'social',
        campaign: 'manual_phase3',
        content: `${body.category}_manual_v1`,
      },
      quality_score: 80,
      quality_breakdown: {
        accuracy: 80,
        freshness: 80,
        rarity: 80,
        newcomer_clarity: 80,
        appeal: 80,
        route_clarity: 80,
        conversation_shareability: 80,
      },
      freshness_score: 80,
      rights_gate: 'not_applicable',
      approval_status: 'pending_review',
      risks: ['manual_authority_attested'],
      human_review_required: ['本文、権利、プライバシー、リンクを公開直前に再確認'],
      idempotency_key: `manual:${identity}`,
      scheduled_at: null,
      published_post_id: null,
      created_at: now,
      updated_at: now,
    };
    if (!(await getCubelicContent(c.env.DB, contentId))) {
      await createCubelicContent(c.env.DB, content, {
        actor: 'human',
        action: 'content.manual_created',
        entityType: 'content',
        entityId: contentId,
        before: {},
        after: contentAuditSnapshot(content),
        correlationId: correlationId(c),
      });
      await createCubelicManualAuthority(c.env.DB, authority, {
        actor: 'human',
        action: 'manual_authority.created',
        entityType: 'content',
        entityId: contentId,
        before: {},
        after: {
          schemaVersion: authority.schema_version,
          attestedBy: authority.attested_by,
          attestedAt: authority.attested_at,
          rightsConfirmed: true,
          privacyReviewCompleted: true,
          linkValidated: true,
        },
        correlationId: correlationId(c),
      });
    }
    const [stored] = await createCubelicDrafts(c.env.DB, [draft], [{
      actor: 'human',
      action: 'draft.manual_created',
      entityType: 'draft',
      entityId: draftId,
      before: {},
      after: await draftAuditSnapshot(draft),
      correlationId: correlationId(c),
    }]);
    return c.json({ success: true, data: stored }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.get('/api/cubelic/drafts', async (c) => c.json({ success: true, data: await listCubelicDrafts(c.env.DB, c.req.query('status')) }));

cubelic.get('/api/cubelic/drafts/:id', async (c) => {
  const draft = await getCubelicDraft(c.env.DB, c.req.param('id'));
  return draft ? c.json({ success: true, data: draft }) : c.json({ success: false, error: 'Draft not found' }, 404);
});

async function publicationCandidate(c: Context<Env>, draftId: string) {
  const draft = await getCubelicDraft(c.env.DB, draftId);
  if (!draft) return null;
  if (!['approved', 'handed_off'].includes(draft.approval_status) || !draft.approved_by || !draft.approved_at) {
    throw new PublicationPolicyError('human_approval_required', 'A human-approved draft is required');
  }
  let privacyReviewCompleted = true;
  for (const assetId of draft.media_asset_ids) {
    const media = await getCubelicMedia(c.env.DB, assetId);
    if (!media?.privacy.manual_review_completed || media.status !== 'approved_for_draft') {
      privacyReviewCompleted = false;
      break;
    }
  }
  let linkValidated = false;
  try {
    linkValidated = new URL(draft.destination_url).protocol === 'https:';
  } catch {
    linkValidated = false;
  }
  if (!privacyReviewCompleted) {
    throw new PublicationPolicyError('privacy_review_required', 'All attached media require completed privacy review');
  }
  if (!linkValidated) {
    throw new PublicationPolicyError('link_validation_required', 'The approved destination must be a valid HTTPS URL');
  }
  return {
    draftId: draft.draft_id,
    accountId: draft.account_id,
    text: draft.text,
    mediaAssetIds: draft.media_asset_ids,
    category: draft.category,
    templateId: draft.template_id,
    approvalStatus: 'approved' as const,
    approvedBy: draft.approved_by,
    approvedAt: draft.approved_at,
    rightsGate: draft.rights_gate,
    privacyReviewCompleted: true as const,
    linkValidated: true as const,
    idempotencyKey: draft.idempotency_key,
  };
}

cubelic.post('/api/cubelic/content/:id/manual-authority', async (c) => {
  try {
    if (!isPhase3PublicationEnabled(c.env)) {
      throw new PublicationPolicyError('phase3_operation_disabled', 'Phase 3 publication capability is disabled');
    }
    const denied = await requireNamedHumanApproval(c);
    if (denied) return denied;
    const content = await getCubelicContent(c.env.DB, c.req.param('id'));
    if (!content) return c.json({ success: false, error: 'Content not found' }, 404);
    if (content.source_type !== 'manual') {
      throw new PublicationPolicyError('manual_source_required', 'Only manual content can receive manual authority');
    }
    const body = await c.req.json<{
      rightsConfirmed?: boolean;
      privacyReviewCompleted?: boolean;
      linkValidated?: boolean;
    }>();
    const authority = authorizeManualProductionInput({
      contentId: content.content_id,
      attestedBy: namedHumanId(c),
      attestedAt: new Date().toISOString(),
      rightsConfirmed: body.rightsConfirmed === true,
      privacyReviewCompleted: body.privacyReviewCompleted === true,
      destinationUrl: content.destination.base_url,
      linkValidated: body.linkValidated === true,
    });
    const stored = await createCubelicManualAuthority(c.env.DB, authority, {
      actor: 'human',
      action: 'manual_authority.created',
      entityType: 'content',
      entityId: content.content_id,
      before: {},
      after: {
        schemaVersion: authority.schema_version,
        attestedBy: authority.attested_by,
        attestedAt: authority.attested_at,
        rightsConfirmed: true,
        privacyReviewCompleted: true,
        linkValidated: true,
      },
      correlationId: correlationId(c),
    });
    return c.json({ success: true, data: { ...authority, authority_id: stored.authorityId } }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/drafts/:id/publish', async (c) => {
  try {
    if (!isPhase3PublicationEnabled(c.env)) {
      throw new PublicationPolicyError('phase3_operation_disabled', 'Phase 3 publication capability is disabled');
    }
    const denied = await requireNamedHumanApproval(c);
    if (denied) return denied;
    const candidate = await publicationCandidate(c, c.req.param('id'));
    if (!candidate) return c.json({ success: false, error: 'Draft not found' }, 404);
    const operatorId = namedHumanId(c);
    const adapter = (c.get('cubelicPhase3AdapterFactory') ?? buildCubelicPhase3XAdapter)(c.env, operatorId);
    const result = await adapter.publishPost({
      ...candidate,
      authorization: {
        kind: 'human_individual',
        operatorId,
        authorizedAt: new Date().toISOString(),
      },
    });
    return c.json({ success: true, data: result }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/drafts/:id/schedule', async (c) => {
  try {
    if (!isPhase3PublicationEnabled(c.env)) {
      throw new PublicationPolicyError('phase3_operation_disabled', 'Phase 3 publication capability is disabled');
    }
    if (actor(c) === 'human') {
      const denied = await requireHumanApproval(c);
      if (denied) return denied;
    }
    const body = await c.req.json<{ scheduledAt?: string; policyId?: string }>();
    if (!body.scheduledAt || !body.policyId) {
      throw new PublicationPolicyError('schedule_authority_invalid', 'scheduledAt and policyId are required');
    }
    const candidate = await publicationCandidate(c, c.req.param('id'));
    if (!candidate) return c.json({ success: false, error: 'Draft not found' }, 404);
    const adapter = (c.get('cubelicPhase3AdapterFactory') ?? buildCubelicPhase3XAdapter)(c.env, actorName(c));
    const result = await adapter.schedulePost({
      ...candidate,
      scheduledAt: body.scheduledAt,
      authorization: {
        kind: 'preapproved_template',
        policyId: body.policyId,
        approvedBy: candidate.approvedBy,
        approvedAt: candidate.approvedAt,
      },
    });
    return c.json({ success: true, data: result }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.get('/api/cubelic/x-harness-inbox/:draftId', async (c) => {
  const denied = await requireHumanApproval(c);
  if (denied) return denied;
  const inertDraft = await getCubelicInertDraft(c.env.DB, c.req.param('draftId'));
  return inertDraft
    ? c.json({ success: true, data: inertDraft })
    : c.json({ success: false, error: 'Inert X Harness draft not found' }, 404);
});

cubelic.patch('/api/cubelic/drafts/:id', async (c) => {
  try {
    const draft = await getCubelicDraft(c.env.DB, c.req.param('id'));
    if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404);
    const content = await getCubelicContent(c.env.DB, draft.content_id);
    if (!content?.event_id) throw new ContentPolicyError('event_unknown', 'Draft content has no event', ['event_unknown']);
    if (!['pending_review', 'needs_revision'].includes(draft.approval_status)) return c.json({ success: false, error: 'Draft is immutable in its current state' }, 409);
    const body = await c.req.json<{ text?: string }>();
    if (!body.text) throw new ContentPolicyError('invalid_request', 'text is required', ['incorrect_metadata']);
    validatePostText(body.text);
    const recent = await recentOtherDraftTexts(c.env.DB, draft.content_id);
    if (isDuplicateText(body.text, recent)) throw new ContentPolicyError('duplicate_content', 'Draft is too similar to existing content', ['duplicate_content']);
    await updateCubelicDraftText(c.env.DB, draft.draft_id, body.text, { actor: actor(c), action: 'draft.text_updated', entityType: 'draft', entityId: draft.draft_id, before: { text_sha256: await sha256Json(draft.text) }, after: { text_sha256: await sha256Json(body.text) }, correlationId: correlationId(c) });
    return c.json({ success: true, data: await getCubelicDraft(c.env.DB, draft.draft_id) });
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/drafts/:id/approve', async (c) => {
  try {
    const denied = isPhase3PublicationEnabled(c.env)
      ? await requireNamedHumanApproval(c)
      : await requireHumanApproval(c);
    if (denied) return denied;
    let draft = await getCubelicDraft(c.env.DB, c.req.param('id'));
    if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404);
    const content = await getCubelicContent(c.env.DB, draft.content_id);
    if (!content) throw new ContentPolicyError('incorrect_metadata', 'Draft content item is missing', ['incorrect_metadata']);
    if (content.content_lifecycle.expires_at && Date.parse(content.content_lifecycle.expires_at) <= Date.now()) {
      throw new ContentPolicyError('expired_content', 'Content lifecycle has expired', ['expired_content']);
    }
    const manualAuthority = content.source_type === 'manual'
      ? await getCubelicManualAuthority(c.env.DB, content.content_id)
      : null;
    if (!content.event_id) {
      if (!isPhase3PublicationEnabled(c.env) || !manualAuthority) {
        throw new ContentPolicyError('event_unknown', 'Draft content has no event or manual production authority', ['event_unknown']);
      }
    } else {
      const approvalEvent = await getCubelicEvent(c.env.DB, content.event_id);
      if (!approvalEvent) throw new ContentPolicyError('event_unknown', 'Draft event is missing', ['event_unknown']);
      assertDraftableEventState(content, approvalEvent);
      await assertCanonicalContentReferences(c.env.DB, content);
    }
    const emergencyStopped = c.env.GLOBAL_PUBLISHING_DISABLED !== 'false' || await getCubelicEmergencyStop(c.env.DB);
    assertDraftApprovalGates(draft, { humanApproved: true, emergencyStopped, allowReserved: true });
    for (const assetId of draft.media_asset_ids) {
      const media = await getCubelicMedia(c.env.DB, assetId);
      const event = media ? await getCubelicEvent(c.env.DB, media.event_id) : null;
      if (!media || !event) throw new ContentPolicyError('incorrect_metadata', 'Draft media or event is missing', ['incorrect_metadata']);
      if (media.event_id !== content.event_id) {
        throw new ContentPolicyError('incorrect_metadata', 'Draft media event does not match the content event', ['incorrect_metadata']);
      }
      const rights = evaluateRights(event, media);
      if (!rights.passed) throw new ContentPolicyError('rights_gate_failed', 'Rights must be revalidated at approval', rights.rejectReasons);
    }
    if (!c.env.X_HARNESS_ACCOUNT_ID || c.env.X_HARNESS_ACCOUNT_ID === 'SET_AFTER_ACCOUNT_SETUP') {
      return c.json({ success: false, error: 'X Harness account mapping is not configured', code: 'x_harness_account_not_configured' }, 503);
    }
    if (draft.approval_status === 'pending_review') {
      const approverId = isPhase3PublicationEnabled(c.env) ? namedHumanId(c) : actorName(c);
      await reserveCubelicDraftApproval(c.env.DB, draft.draft_id, approverId, {
        actor: 'human',
        action: 'draft.approval_reserved',
        entityType: 'draft',
        entityId: draft.draft_id,
        before: { status: 'pending_review' },
        after: { status: 'approved' },
        correlationId: correlationId(c),
      });
      const reservedDraft = await getCubelicDraft(c.env.DB, draft.draft_id);
      if (!reservedDraft) throw new Error('Reserved draft disappeared');
      draft = reservedDraft;
      assertDraftApprovalGates(draft, { humanApproved: true, emergencyStopped, allowReserved: true });
    }
    if (isPhase3PublicationEnabled(c.env)) {
      return c.json({
        success: true,
        data: {
          draft,
          publicationReady: true,
          xHarnessDraft: null,
        },
      });
    }
    const approvedAt = new Date().toISOString();
    const adapter = (c.get('cubelicAdapterFactory') ?? buildCubelicXAdapter)(c.env.DB, c.env.X_HARNESS_ACCOUNT_ID);
    const result = await adapter.createDraft({
      draftId: draft.draft_id,
      accountId: draft.account_id,
      text: draft.text,
      mediaAssetIds: draft.media_asset_ids,
      idempotencyKey: draft.idempotency_key,
      approvedBy: actorName(c),
      approvedAt,
    });
    await handoffCubelicDraftAndStop(c.env.DB, {
      draftId: draft.draft_id,
      actor: actorName(c),
      inboxId: result.inboxId,
    }, {
      draft: { actor: 'human', action: 'draft.approved_and_handed_off', entityType: 'draft', entityId: draft.draft_id, before: { status: 'approved' }, after: { status: 'handed_off', inboxId: result.inboxId }, correlationId: correlationId(c) },
      operationWindow: { actor: 'human', action: 'system.operation_window_closed_after_handoff', entityType: 'system', entityId: 'operation_window', before: { eventId: content.event_id }, after: { stopped: true }, correlationId: correlationId(c) },
    });
    return c.json({ success: true, data: { draft: await getCubelicDraft(c.env.DB, draft.draft_id), xHarnessDraft: result } });
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/drafts/:id/reject', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    const draft = await getCubelicDraft(c.env.DB, c.req.param('id'));
    if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404);
    const content = await getCubelicContent(c.env.DB, draft.content_id);
    if (!content?.event_id) throw new ContentPolicyError('event_unknown', 'Draft content has no event', ['event_unknown']);
    if (!['pending_review', 'needs_revision'].includes(draft.approval_status)) return c.json({ success: false, error: 'Draft cannot be rejected in its current state' }, 409);
    const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}));
    const reason: RejectReason = isRejectReason(body.reason) ? body.reason : 'manual_rejection';
    await setCubelicDraftDecision(
      c.env.DB,
      { draftId: draft.draft_id, status: 'rejected', actor: actorName(c), rejectReason: reason },
      { actor: 'human', action: 'draft.rejected', entityType: 'draft', entityId: draft.draft_id, before: { status: draft.approval_status }, after: { status: 'rejected', reason }, correlationId: correlationId(c) },
      rejectionInput(c, [reason]),
    );
    return c.json({ success: true, data: await getCubelicDraft(c.env.DB, draft.draft_id) });
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/metrics/collect', async (c) => {
  try {
    const body = await c.req.json<{ postId?: string; window?: '2h' | '24h' | '72h' | '7d' }>();
    if (!body.postId || !body.window || !['2h', '24h', '72h', '7d'].includes(body.window)) {
      throw new ContentPolicyError('invalid_request', 'postId and a valid window are required', ['incorrect_metadata']);
    }
    if (!(await getCubelicPublishedPostMapping(c.env.DB, body.postId))) {
      throw new ContentPolicyError('invalid_request', 'Post id is not mapped to an approved CUBΣLIC draft', ['incorrect_metadata']);
    }
    const adapter = (c.get('cubelicAdapterFactory') ?? buildCubelicXAdapter)(c.env.DB, c.env.X_HARNESS_ACCOUNT_ID ?? 'unconfigured');
    const values = await adapter.getMetrics(body.postId);
    const existingMetrics = await getCubelicMetricsSnapshot(c.env.DB, body.postId, body.window);
    const collectedAt = new Date().toISOString();
    await saveCubelicMetrics(c.env.DB, { postId: body.postId, window: body.window, values, collectedAt }, { actor: actor(c), action: 'metrics.collected', entityType: 'post', entityId: body.postId, before: existingMetrics ?? {}, after: { postId: body.postId, window: body.window, values, collectedAt }, correlationId: correlationId(c) });
    return c.json({ success: true, data: { postId: body.postId, window: body.window, values } }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/metrics/post-mappings', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    const body = await c.req.json<{ draftId?: string; postId?: string; publishedAt?: string }>();
    if (!body.draftId || !body.postId || !body.publishedAt || !/^\d{5,30}$/.test(body.postId) || Number.isNaN(Date.parse(body.publishedAt))) {
      throw new ContentPolicyError('invalid_request', 'draftId, numeric postId and ISO publishedAt are required', ['incorrect_metadata']);
    }
    const draft = await getCubelicDraft(c.env.DB, body.draftId);
    if (!draft || draft.approval_status !== 'handed_off') {
      throw new ContentPolicyError('invalid_approval_state', 'Only a handed-off draft may be mapped to a manually published post', ['incorrect_metadata']);
    }
    const content = await getCubelicContent(c.env.DB, draft.content_id);
    if (!content?.event_id) throw new ContentPolicyError('event_unknown', 'Draft content has no event', ['event_unknown']);
    const mapping = await createCubelicPublishedPostMapping(c.env.DB, {
      draftId: draft.draft_id,
      postId: body.postId,
      publishedAt: new Date(body.publishedAt).toISOString(),
      createdBy: actorName(c),
    }, {
      actor: 'human',
      action: 'metrics.post_mapped',
      entityType: 'post',
      entityId: body.postId,
      before: {},
      after: { draftId: draft.draft_id, source: 'manual' },
      correlationId: correlationId(c),
    });
    return c.json({ success: true, data: mapping }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.get('/api/cubelic/metrics/summary', async (c) => c.json({ success: true, data: await getCubelicMetricsSummary(c.env.DB) }));

cubelic.get('/api/cubelic/rejections/summary', async (c) => {
  const since = c.req.query('since') ?? new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  if (Number.isNaN(Date.parse(since))) return c.json({ success: false, error: 'since must be an ISO 8601 timestamp' }, 400);
  return c.json({ success: true, data: await getCubelicRejectionSummary(c.env.DB, new Date(since).toISOString()) });
});

cubelic.get('/api/cubelic/admin/status', async (c) => c.json({
  success: true,
  data: {
    safeMode: !isPhase3PublicationEnabled(c.env),
    phase3Enabled: isPhase3PublicationEnabled(c.env),
    environmentStop: c.env.GLOBAL_PUBLISHING_DISABLED !== 'false',
    emergencyStop: await getCubelicEmergencyStop(c.env.DB),
    operationWindow: await getCubelicOperationWindow(c.env.DB),
    publishingEnabled: isPhase3PublicationEnabled(c.env)
      && c.env.GLOBAL_PUBLISHING_DISABLED === 'false'
      && !(await getCubelicEmergencyStop(c.env.DB)),
    schedulingEnabled: isPhase3PublicationEnabled(c.env)
      && c.env.GLOBAL_PUBLISHING_DISABLED === 'false'
      && !(await getCubelicEmergencyStop(c.env.DB)),
  },
}));

cubelic.post('/api/cubelic/admin/emergency-stop', async (c) => {
  const denied = await requireHumanApproval(c);
  if (denied) return denied;
  const wasStopped = await getCubelicEmergencyStop(c.env.DB);
  await closeCubelicOperationWindowAndStop(c.env.DB, actorName(c), { actor: 'human', action: 'system.emergency_stop', entityType: 'system', entityId: 'publishing', before: { stopped: wasStopped }, after: { stopped: true, operationWindowClosed: true }, correlationId: correlationId(c) });
  return c.json({ success: true, data: { stopped: true } });
});

cubelic.post('/api/cubelic/admin/operation-window', async (c) => {
  try {
    const denied = await requireHumanApproval(c);
    if (denied) return denied;
    if (c.env.GLOBAL_PUBLISHING_DISABLED !== 'false') {
      return c.json({ success: false, error: 'Environment lock must be explicitly false before opening an operation window', code: 'environment_stop_active' }, 423);
    }
    const body = await c.req.json<{ eventId?: string; durationMinutes?: number }>();
    if (!body.eventId || !/^evt_[A-Za-z0-9_-]+$/.test(body.eventId) || !Number.isInteger(body.durationMinutes) || body.durationMinutes! < 1 || body.durationMinutes! > 30) {
      throw new ContentPolicyError('invalid_request', 'eventId and durationMinutes from 1 to 30 are required', ['incorrect_metadata']);
    }
    const existingWindow = await getCubelicOperationWindow(c.env.DB);
    if (existingWindow?.active) {
      return c.json({ success: false, error: 'An operation window is already active', code: 'operation_window_already_active' }, 409);
    }
    if (existingWindow) {
      await closeCubelicOperationWindowAndStop(c.env.DB, actorName(c), { actor: 'human', action: 'system.expired_operation_window_replaced', entityType: 'system', entityId: 'operation_window', before: { eventId: existingWindow.eventId, expiresAt: existingWindow.expiresAt }, after: { stopped: true }, correlationId: correlationId(c) });
    }
    const expiresAt = new Date(Date.now() + body.durationMinutes! * 60_000).toISOString();
    await setCubelicOperationWindow(c.env.DB, { eventId: body.eventId, expiresAt, actor: actorName(c) }, { actor: 'human', action: 'system.operation_window_opened', entityType: 'system', entityId: 'operation_window', before: existingWindow ? { eventId: existingWindow.eventId, expiresAt: existingWindow.expiresAt, active: false } : {}, after: { eventId: body.eventId, expiresAt }, correlationId: correlationId(c) });
    return c.json({ success: true, data: { eventId: body.eventId, expiresAt } }, 201);
  } catch (error) { return apiError(c, error); }
});

cubelic.post('/api/cubelic/admin/emergency-resume', async (c) => {
  const denied = await requireHumanApproval(c);
  if (denied) return denied;
  if (c.env.GLOBAL_PUBLISHING_DISABLED !== 'false') {
    return c.json({ success: false, error: 'Environment lock is active and cannot be resumed through the API', code: 'environment_stop_active' }, 423);
  }
  if (isPhase3PublicationEnabled(c.env)) {
    const wasStopped = await getCubelicEmergencyStop(c.env.DB);
    await setCubelicEmergencyStop(c.env.DB, false, actorName(c), {
      actor: 'human',
      action: 'system.normal_operation_resumed',
      entityType: 'system',
      entityId: 'publishing',
      before: { stopped: wasStopped },
      after: { stopped: false, phase3: true },
      correlationId: correlationId(c),
    });
    return c.json({ success: true, data: { stopped: false, normalOperation: true } });
  }
  const operationWindow = await getCubelicOperationWindow(c.env.DB);
  if (!operationWindow?.active) {
    return c.json({ success: false, error: 'A valid production operation window is required before resume', code: 'operation_window_inactive' }, 423);
  }
  const wasStopped = await getCubelicEmergencyStop(c.env.DB);
  await setCubelicEmergencyStop(c.env.DB, false, actorName(c), { actor: 'human', action: 'system.emergency_resume', entityType: 'system', entityId: 'publishing', before: { stopped: wasStopped }, after: { stopped: false }, correlationId: correlationId(c) });
  return c.json({ success: true, data: { stopped: false } });
});
