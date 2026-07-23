import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import {
  generateSetlistDrafts,
  emptyMetrics,
  type ContentItem,
  type EventRecord,
  type GasSetlistV1,
  type MediaAsset,
} from '@x-harness/content-os';
import {
  appendCubelicAudit,
  claimCubelicPublicationJob,
  completeCubelicPublicationJob,
  createCubelicContent,
  createCubelicDrafts,
  createCubelicEvent,
  createCubelicInertDraft,
  createCubelicManualAuthority,
  createCubelicMedia,
  createCubelicPublicationJob,
  createCubelicPublishedPostMapping,
  expireCubelicOperationWindowAndStop,
  getCubelicEmergencyStop,
  getCubelicOperationWindow,
  getCubelicPublicationJob,
  getCubelicInertDraft,
  getCubelicMetricsSummary,
  handoffCubelicDraftAndStop,
  listCubelicDrafts,
  reserveCubelicDraftApproval,
  recordCubelicRejections,
  reconcileCubelicPublicationNotPublished,
  reconcileCubelicPublicationPublished,
  setCubelicDraftDecision,
  setCubelicEmergencyStop,
  setCubelicOperationWindow,
  updateCubelicDraftText,
  upsertCubelicSongMaster,
  saveCubelicMetrics,
  type AuditInput,
} from './cubelic.js';
import { compileMigrationForD1Exec } from './d1-test-utils.js';

const migrationPaths = [
  fileURLToPath(new URL('../migrations/018-cubelic-content-os.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/019-cubelic-fail-closed-boundaries.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/020-cubelic-phase3-publication.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/021-cubelic-publication-reconciliation.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/022-cubelic-operation-window-publication-lock.sql', import.meta.url)),
];

function audit(action: string, entityId: string): AuditInput {
  return { actor: 'system', action, entityType: 'integration', entityId, before: {}, after: {}, correlationId: `corr_${entityId}` };
}

const eventFixture: EventRecord = {
  event_id: 'evt_d1_integration',
  title: 'CUBΣLIC D1 TEST',
  venue: 'TEST VENUE',
  starts_at: '2026-07-21T19:00:00+09:00',
  ends_at: '2026-07-21T20:30:00+09:00',
  state: 'setlist_confirmed',
  event_tags: [],
  filming_policy: {
    confirmed: true,
    scope: 'full_event',
    evidence_type: 'staff_confirmation',
    evidence_url: 'https://example.test/evidence/1',
    confirmed_at: '2026-07-21T18:00:00+09:00',
    confirmed_by: 'human_operator',
  },
};
const setlistFixture: GasSetlistV1 = {
  schema_version: 'cubelic.gas-setlist.v1',
  event_id: eventFixture.event_id,
  event_title: eventFixture.title,
  venue: eventFixture.venue,
  starts_at: eventFixture.starts_at,
  ends_at: eventFixture.ends_at,
  lp_url: 'https://example.test/setlists/evt_d1_integration',
  confirmed_at: '2026-07-21T20:40:00+09:00',
  confirmed_by: 'integration-operator',
  songs: [{ position: 1, song_id: 'song_d1_1', title: 'Integration Song' }],
};
const contentFixture: ContentItem = {
  content_id: 'cnt_d1_integration',
  event_id: eventFixture.event_id,
  category: 'setlist_flash',
  target_stage: 'interested',
  content_lifecycle: { type: 'hybrid', expires_at: null },
  status: 'draft_generated',
  source_type: 'setlist_json',
  source_refs: ['set_d1_1'],
  member_ids: [],
  song_ids: ['song_d1_1'],
  emotion_tags: ['informative'],
  destination: { type: 'setlist_page', base_url: setlistFixture.lp_url, tracked_url: '' },
  created_at: '2026-07-21T20:41:00+09:00',
  updated_at: '2026-07-21T20:41:00+09:00',
};
const mediaFixture: MediaAsset = {
  asset_id: 'ast_d1_integration',
  event_id: eventFixture.event_id,
  path: '/exports/integration.mp4',
  sha256: 'a'.repeat(64),
  duration_seconds: 10,
  orientation: 'vertical',
  resolution: '1080x1920',
  audio_present: true,
  rights: { filming_policy_confirmed: true, publishing_allowed: true, evidence_url: 'https://example.test/evidence/1', song_scope_confirmed: true },
  privacy: { audience_visible: false, third_party_faces_detected: false, manual_review_completed: true, cropping_required: false, blurring_required: false },
  quality: { video_ok: true, audio_ok: true, sync_ok: true, score: 90 },
  status: 'approved_for_draft',
};

async function createOutcomeUnknownPublicationFixture(db: D1Database) {
  await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'reconciliation_fixture'));
  await createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id));
  await createCubelicContent(db, contentFixture, audit('content.created', contentFixture.content_id));
  await upsertCubelicSongMaster(db, {
    schema_version: 'cubelic.song-master.v1',
    generated_at: '2026-07-21T18:00:00+09:00',
    songs: [{ song_id: 'song_d1_1', title: 'Integration Song', aliases: [], active: true }],
  }, [audit('song_master.upserted', 'song_d1_1')]);
  const generated = await generateSetlistDrafts({
    setlist: setlistFixture,
    content: contentFixture,
    event: eventFixture,
    now: '2026-07-21T20:45:00+09:00',
  });
  const drafts = await createCubelicDrafts(
    db,
    generated,
    generated.map((draft) => audit('draft.created', draft.draft_id)),
  );
  const draft = drafts[0]!;
  await reserveCubelicDraftApproval(
    db,
    draft.draft_id,
    'integration-operator',
    audit('draft.approval_reserved', draft.draft_id),
  );
  const job = await createCubelicPublicationJob(db, {
    draftId: draft.draft_id,
    operation: 'publish',
    authorizationKind: 'human_individual',
    authorizedBy: 'integration-operator',
    authorizedAt: '2026-07-23T01:04:00.000Z',
    idempotencyKey: `${draft.idempotency_key}:publish`,
  }, audit('publication.started', draft.draft_id));
  await setCubelicEmergencyStop(db, true, 'integration-operator', audit('system.emergency_stop', 'reconciliation_fixture'));
  return { draft, job };
}

describe('CUBΣLIC D1 integration', () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: '2024-12-01',
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: { DB: 'cubelic-integration-test' },
    });
    db = await miniflare.getD1Database('DB') as unknown as D1Database;
    for (const migrationPath of migrationPaths) {
      await db.exec(compileMigrationForD1Exec(await readFile(migrationPath, 'utf8')));
    }
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  it('expires and atomically closes an event-bound operation window', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await setCubelicOperationWindow(db, {
      eventId: eventFixture.event_id,
      expiresAt,
      actor: 'integration-operator',
    }, audit('system.operation_window_opened', 'operation_window'));

    await expect(getCubelicOperationWindow(db)).resolves.toEqual({
      eventId: eventFixture.event_id,
      expiresAt,
      active: true,
    });
    await expect(getCubelicOperationWindow(db, Date.parse(expiresAt) + 1)).resolves.toMatchObject({ active: false });

    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'operation_window'));
    await expect(expireCubelicOperationWindowAndStop(db, Date.parse(expiresAt) + 1)).resolves.toBe(true);
    await expect(expireCubelicOperationWindowAndStop(db, Date.parse(expiresAt) + 1)).resolves.toBe(false);
    await expect(getCubelicOperationWindow(db)).resolves.toBeNull();
    await expect(getCubelicEmergencyStop(db)).resolves.toBe(true);
    expect((await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action = 'system.operation_window_expired'",
    ).first<{ count: number }>())?.count).toBe(1);
  });

  it('keeps operation windows and publishing jobs mutually exclusive in D1', async () => {
    const first = await createOutcomeUnknownPublicationFixture(db);
    await expect(setCubelicOperationWindow(db, {
      eventId: eventFixture.event_id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      actor: 'integration-operator',
    }, audit('system.operation_window_opened', 'publishing_race'))).rejects.toThrow(/publication in progress/);
    await expect(getCubelicOperationWindow(db)).resolves.toBeNull();

    const retryIdempotencyKey = `${first.draft.idempotency_key}:retry:window-lock`;
    await reconcileCubelicPublicationNotPublished(db, {
      jobId: first.job.jobId,
      actor: 'integration-operator',
      retryIdempotencyKey,
      failureCode: 'reconciled_no_matching_post',
      evidence: {
        recentPostsChecked: 10,
        postIdMatchFound: false,
        fixedTextPrefixMatchFound: false,
      },
    }, {
      publication: audit('publication.reconciled_failed', first.job.jobId),
      draft: audit('draft.retry_idempotency_issued', first.draft.draft_id),
      stop: audit('system.reconciliation_stop_preserved', 'publishing'),
    });
    await setCubelicOperationWindow(db, {
      eventId: eventFixture.event_id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      actor: 'integration-operator',
    }, audit('system.operation_window_opened', 'publication_race'));
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publication_race'));
    await expect(createCubelicPublicationJob(db, {
      draftId: first.draft.draft_id,
      operation: 'publish',
      authorizationKind: 'human_individual',
      authorizedBy: 'integration-operator',
      authorizedAt: new Date().toISOString(),
      idempotencyKey: `${retryIdempotencyKey}:publish`,
    }, audit('publication.started', first.draft.draft_id))).rejects.toThrow(/operation window blocks publication/);
  });

  it('persists human-attested manual authority and audited Phase 3 publication jobs', async () => {
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'phase3'));
    await createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id));
    const manualContent = {
      ...contentFixture,
      category: 'event_notice' as const,
      source_type: 'manual' as const,
      song_ids: [],
      source_refs: ['manual:operator_1'],
      destination: {
        type: 'manual_https',
        base_url: 'https://example.test/events/phase3',
        tracked_url: 'https://example.test/events/phase3?utm_source=x&utm_medium=social',
      },
    };
    await createCubelicContent(db, manualContent, audit('content.created', manualContent.content_id));
    await createCubelicManualAuthority(db, {
      schema_version: 'cubelic.manual-production-authority.v1',
      content_id: manualContent.content_id,
      source_type: 'manual',
      attested_by: 'integration-operator',
      attested_at: '2026-07-23T01:00:00.000Z',
      rights_confirmed: true,
      privacy_review_completed: true,
      destination_url: 'https://example.test/events/phase3',
      link_validated: true,
    }, audit('manual_authority.created', manualContent.content_id));
    const drafts = [{
      draft_id: 'drf_manual_d1',
      content_id: manualContent.content_id,
      account_id: 'tubelic_cube',
      text: '人間が確認したライブ予定です https://example.test/events/phase3',
      media_asset_ids: [],
      category: 'event_notice' as const,
      template_id: 'event_notice_manual_v1',
      template_version: '1.0.0',
      variant: 'a' as const,
      target_stage: 'interested' as const,
      emotion_tags: ['informative'],
      hashtags: [],
      destination_url: 'https://example.test/events/phase3',
      utm: { source: 'x' as const, medium: 'social' as const, campaign: 'manual_phase3', content: 'event_notice_manual_v1' },
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
      rights_gate: 'not_applicable' as const,
      approval_status: 'pending_review' as const,
      risks: ['manual_authority_attested'],
      human_review_required: ['manual review'],
      idempotency_key: 'manual:d1:phase3',
      scheduled_at: null,
      published_post_id: null,
      created_at: '2026-07-23T01:01:00.000Z',
      updated_at: '2026-07-23T01:01:00.000Z',
    }];
    const [draft] = await createCubelicDrafts(
      db,
      drafts,
      drafts.map((item) => audit('draft.created', item.draft_id)),
    );
    await reserveCubelicDraftApproval(
      db,
      draft.draft_id,
      'integration-operator',
      audit('draft.approval_reserved', draft.draft_id),
    );

    const job = await createCubelicPublicationJob(db, {
      draftId: draft.draft_id,
      operation: 'publish',
      authorizationKind: 'human_individual',
      authorizedBy: 'integration-operator',
      authorizedAt: '2026-07-23T01:02:00.000Z',
      idempotencyKey: `${draft.idempotency_key}:publish`,
    }, audit('publication.started', draft.draft_id));
    expect(job).toMatchObject({ operation: 'publish', status: 'publishing' });

    const completed = await completeCubelicPublicationJob(db, {
      jobId: job.jobId,
      postId: '1999999999999999999',
      publishedAt: '2026-07-23T01:03:00.000Z',
    }, audit('publication.completed', job.jobId));
    expect(completed).toMatchObject({
      status: 'published',
      postId: '1999999999999999999',
    });
    await expect(getCubelicPublicationJob(db, job.jobId)).resolves.toMatchObject({ status: 'published' });

    const scheduled = await createCubelicPublicationJob(db, {
      draftId: draft.draft_id,
      operation: 'schedule',
      authorizationKind: 'preapproved_template',
      policyId: 'policy_1',
      authorizedBy: 'integration-operator',
      authorizedAt: '2026-07-23T01:04:00.000Z',
      scheduledAt: '2026-07-25T01:00:00.000Z',
      idempotencyKey: `${draft.idempotency_key}:schedule:claim`,
    }, audit('publication.scheduled', draft.draft_id));
    await expect(createCubelicPublicationJob(db, {
      draftId: draft.draft_id,
      operation: 'schedule',
      authorizationKind: 'preapproved_template',
      policyId: 'policy_1',
      authorizedBy: 'integration-operator',
      authorizedAt: '2026-07-23T01:04:00.000Z',
      scheduledAt: '2026-07-25T03:00:00.000Z',
      idempotencyKey: `${draft.idempotency_key}:schedule:too-close`,
    }, audit('publication.scheduled', `${draft.draft_id}:too-close`))).rejects.toThrow(/rate slot unavailable/);
    const claims = await Promise.all([
      claimCubelicPublicationJob(db, scheduled.jobId, audit('publication.claimed', `${scheduled.jobId}:a`)),
      claimCubelicPublicationJob(db, scheduled.jobId, audit('publication.claimed', `${scheduled.jobId}:b`)),
    ]);
    expect(claims.sort()).toEqual([false, true]);
    expect((await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action = 'publication.claimed'",
    ).first<{ count: number }>())?.count).toBe(1);

    const rollingDates = [
      '2026-08-28T00:00:00.000Z', '2026-08-28T05:00:00.000Z',
      '2026-08-29T00:00:00.000Z', '2026-08-29T05:00:00.000Z',
      '2026-08-30T00:00:00.000Z', '2026-08-30T05:00:00.000Z',
      '2026-08-31T00:00:00.000Z', '2026-08-31T05:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T05:00:00.000Z',
    ];
    for (const [index, scheduledAt] of rollingDates.entries()) {
      await createCubelicPublicationJob(db, {
        draftId: draft.draft_id,
        operation: 'schedule',
        authorizationKind: 'preapproved_template',
        policyId: 'policy_1',
        authorizedBy: 'integration-operator',
        authorizedAt: '2026-07-23T01:04:00.000Z',
        scheduledAt,
        idempotencyKey: `${draft.idempotency_key}:rolling:${index}`,
      }, audit('publication.scheduled', `${draft.draft_id}:rolling:${index}`));
    }
    await expect(createCubelicPublicationJob(db, {
      draftId: draft.draft_id,
      operation: 'schedule',
      authorizationKind: 'preapproved_template',
      policyId: 'policy_1',
      authorizedBy: 'integration-operator',
      authorizedAt: '2026-07-23T01:04:00.000Z',
      scheduledAt: '2026-09-02T00:00:00.000Z',
      idempotencyKey: `${draft.idempotency_key}:rolling:blocked`,
    }, audit('publication.scheduled', `${draft.draft_id}:rolling:blocked`))).rejects.toThrow(/rate slot unavailable/);

    const delayedJobs = [];
    for (const [index, scheduledAt] of [
      '2026-10-01T00:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
    ].entries()) {
      delayedJobs.push(await createCubelicPublicationJob(db, {
        draftId: draft.draft_id,
        operation: 'schedule',
        authorizationKind: 'preapproved_template',
        policyId: 'policy_1',
        authorizedBy: 'integration-operator',
        authorizedAt: '2026-07-23T01:04:00.000Z',
        scheduledAt,
        idempotencyKey: `${draft.idempotency_key}:delayed:${index}`,
      }, audit('publication.scheduled', `${draft.draft_id}:delayed:${index}`)));
    }
    expect(await claimCubelicPublicationJob(
      db,
      delayedJobs[0]!.jobId,
      audit('publication.claimed', `${delayedJobs[0]!.jobId}:actual`),
      '2026-10-20T00:00:00.000Z',
    )).toBe(true);
    await completeCubelicPublicationJob(db, {
      jobId: delayedJobs[0]!.jobId,
      postId: '1999999999999999901',
      publishedAt: '2026-10-20T00:01:00.000Z',
    }, audit('publication.completed', delayedJobs[0]!.jobId));
    expect(await claimCubelicPublicationJob(
      db,
      delayedJobs[1]!.jobId,
      audit('publication.claimed', `${delayedJobs[1]!.jobId}:actual`),
      '2026-10-20T05:00:00.000Z',
    )).toBe(true);
    await completeCubelicPublicationJob(db, {
      jobId: delayedJobs[1]!.jobId,
      postId: '1999999999999999902',
      publishedAt: '2026-10-20T05:01:00.000Z',
    }, audit('publication.completed', delayedJobs[1]!.jobId));
    expect(await claimCubelicPublicationJob(
      db,
      delayedJobs[2]!.jobId,
      audit('publication.claimed', `${delayedJobs[2]!.jobId}:actual`),
      '2026-10-20T10:00:00.000Z',
    )).toBe(false);

    await setCubelicEmergencyStop(db, true, 'integration-operator', audit('system.emergency_stop', 'phase3'));
    await expect(createCubelicPublicationJob(db, {
      draftId: draft.draft_id,
      operation: 'schedule',
      authorizationKind: 'preapproved_template',
      policyId: 'policy_1',
      authorizedBy: 'integration-operator',
      authorizedAt: '2026-07-23T01:04:00.000Z',
      scheduledAt: '2026-07-26T01:00:00.000Z',
      idempotencyKey: `${draft.idempotency_key}:schedule`,
    }, audit('publication.scheduled', draft.draft_id))).rejects.toThrow(/emergency stop active/);
  });

  it('rolls back reconciliation state when its append-only audit cannot be committed', async () => {
    const { draft, job } = await createOutcomeUnknownPublicationFixture(db);
    const retryIdempotencyKey = `${draft.idempotency_key}:retry:atomicity-test`;
    const invalidAudit = {
      actor: 'invalid' as 'human',
      action: 'publication.reconciled_failed',
      entityType: 'publication_job',
      entityId: job.jobId,
      before: { status: 'publishing' },
      after: { status: 'failed' },
      correlationId: 'corr_reconciliation_atomicity',
    };

    await expect(reconcileCubelicPublicationNotPublished(db, {
      jobId: job.jobId,
      actor: 'integration-operator',
      retryIdempotencyKey,
      failureCode: 'reconciled_no_matching_post',
      evidence: {
        recentPostsChecked: 10,
        postIdMatchFound: false,
        fixedTextPrefixMatchFound: false,
      },
    }, {
      publication: invalidAudit,
      draft: audit('draft.retry_idempotency_issued', draft.draft_id),
      stop: audit('system.reconciliation_stop_preserved', 'publishing'),
    })).rejects.toThrow();

    await expect(getCubelicPublicationJob(db, job.jobId)).resolves.toMatchObject({
      status: 'publishing',
      postId: null,
      failureCode: null,
    });
    await expect(getCubelicEmergencyStop(db)).resolves.toBe(true);
    await expect(listCubelicDrafts(db)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        draft_id: draft.draft_id,
        idempotency_key: draft.idempotency_key,
      }),
    ]));
  });

  it('allows only one atomic reconciliation and never changes the stop flag', async () => {
    const { draft, job } = await createOutcomeUnknownPublicationFixture(db);
    const stopBefore = await db.prepare(
      "SELECT value, updated_at, updated_by FROM cubelic_system_flags WHERE key = 'emergency_stop'",
    ).first<{ value: string; updated_at: string; updated_by: string }>();
    const reconcile = (suffix: string) => reconcileCubelicPublicationNotPublished(db, {
      jobId: job.jobId,
      actor: `integration-operator-${suffix}`,
      retryIdempotencyKey: `${draft.idempotency_key}:retry:${suffix}`,
      failureCode: 'reconciled_no_matching_post',
      evidence: {
        recentPostsChecked: 10,
        postIdMatchFound: false,
        fixedTextPrefixMatchFound: false,
      },
    }, {
      publication: { ...audit('publication.reconciled_failed', job.jobId), correlationId: `corr_reconcile_${suffix}` },
      draft: { ...audit('draft.retry_idempotency_issued', draft.draft_id), correlationId: `corr_reconcile_${suffix}` },
      stop: { ...audit('system.reconciliation_stop_preserved', 'publishing'), correlationId: `corr_reconcile_${suffix}` },
    });

    await expect(reconcile('a')).resolves.toMatchObject({
      job: { status: 'failed' },
    });
    await expect(reconcile('b')).rejects.toThrow(/outcome-unknown publishing job/);
    expect((await db.prepare(
      'SELECT COUNT(*) AS count FROM cubelic_publication_reconciliations',
    ).first<{ count: number }>())?.count).toBe(1);
    expect((await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action = 'publication.reconciliation_started'",
    ).first<{ count: number }>())?.count).toBe(1);
    expect((await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action = 'publication.reconciliation_completed'",
    ).first<{ count: number }>())?.count).toBe(1);
    await expect(db.prepare(
      "SELECT value, updated_at, updated_by FROM cubelic_system_flags WHERE key = 'emergency_stop'",
    ).first()).resolves.toEqual(stopBefore);
  });

  it('normalizes a directly reconciled published timestamp to UTC', async () => {
    const { job } = await createOutcomeUnknownPublicationFixture(db);
    await expect(reconcileCubelicPublicationPublished(db, {
      jobId: job.jobId,
      actor: 'staff_integration_operator',
      postId: '2080209283598487956',
      publishedAt: '2026-07-23T17:31:56+09:00',
    }, {
      publication: audit('publication.reconciled_published', job.jobId),
      stop: audit('system.reconciliation_stop_preserved', 'publishing'),
    })).resolves.toMatchObject({
      status: 'published',
      publishedAt: '2026-07-23T08:31:56.000Z',
    });
    await expect(db.prepare(
      'SELECT published_at FROM cubelic_publication_reconciliations WHERE job_id = ?',
    ).bind(job.jobId).first()).resolves.toEqual({
      published_at: '2026-07-23T08:31:56.000Z',
    });
  });

  it('rejects reconciliation when the D1 stop row is missing or invalid', async () => {
    const { draft, job } = await createOutcomeUnknownPublicationFixture(db);
    const notPublished = () => reconcileCubelicPublicationNotPublished(db, {
      jobId: job.jobId,
      actor: 'integration-operator',
      retryIdempotencyKey: `${draft.idempotency_key}:retry:invalid-stop`,
      failureCode: 'reconciled_no_matching_post',
      evidence: {
        recentPostsChecked: 10,
        postIdMatchFound: false,
        fixedTextPrefixMatchFound: false,
      },
    }, {
      publication: audit('publication.reconciled_failed', job.jobId),
      draft: audit('draft.retry_idempotency_issued', draft.draft_id),
      stop: audit('system.reconciliation_stop_preserved', 'publishing'),
    });
    const published = () => reconcileCubelicPublicationPublished(db, {
      jobId: job.jobId,
      actor: 'integration-operator',
      postId: '2080209283598487956',
      publishedAt: '2026-07-23T08:31:56.000Z',
    }, {
      publication: audit('publication.reconciled_published', job.jobId),
      stop: audit('system.reconciliation_stop_preserved', 'publishing'),
    });

    await db.prepare("DELETE FROM cubelic_system_flags WHERE key = 'emergency_stop'").run();
    await expect(notPublished()).rejects.toThrow(/requires the emergency stop/);
    await expect(published()).rejects.toThrow(/requires the emergency stop/);
    await db.prepare(
      `INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by)
       VALUES ('emergency_stop', 'invalid', ?, ?)`,
    ).bind(new Date().toISOString(), 'integration-operator').run();
    await expect(notPublished()).rejects.toThrow(/requires the emergency stop/);
    await expect(published()).rejects.toThrow(/requires the emergency stop/);
    expect((await db.prepare(
      'SELECT COUNT(*) AS count FROM cubelic_publication_reconciliations',
    ).first<{ count: number }>())?.count).toBe(0);
  });

  it('rolls back a stopped draft transition that does not match the recorded retry identity', async () => {
    const { draft, job } = await createOutcomeUnknownPublicationFixture(db);
    const timestamp = new Date().toISOString();
    await expect(db.batch([
      db.prepare(
        `INSERT INTO cubelic_publication_reconciliations (
           reconciliation_id, job_id, outcome, status, actor,
           recent_posts_checked, post_id_match_found, fixed_text_prefix_match_found,
           retry_idempotency_key, post_id, published_at, created_at, completed_at
         ) VALUES (?, ?, 'not_published', 'pending', ?, 10, 0, 0, ?, NULL, NULL, ?, NULL)`,
      ).bind(
        'rec_wrong_retry',
        job.jobId,
        'staff_integration_operator',
        `${draft.idempotency_key}:retry:expected`,
        timestamp,
      ),
      db.prepare(
        `UPDATE cubelic_publication_jobs
         SET status = 'failed', failure_code = 'reconciled_no_matching_post', updated_at = ?
         WHERE job_id = ?`,
      ).bind(timestamp, job.jobId),
      db.prepare(
        'UPDATE cubelic_draft_posts SET idempotency_key = ?, updated_at = ? WHERE draft_id = ?',
      ).bind(`${draft.idempotency_key}:retry:wrong`, timestamp, draft.draft_id),
    ])).rejects.toThrow(/emergency stop active/);

    await expect(getCubelicPublicationJob(db, job.jobId)).resolves.toMatchObject({
      status: 'publishing',
      failureCode: null,
    });
    expect((await db.prepare(
      'SELECT COUNT(*) AS count FROM cubelic_publication_reconciliations',
    ).first<{ count: number }>())?.count).toBe(0);
  });

  it('persists only canonical drafts and makes adapter handoff idempotent', async () => {
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing'));
    await createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id));
    await createCubelicContent(db, contentFixture, audit('content.created', contentFixture.content_id));
    await upsertCubelicSongMaster(db, {
      schema_version: 'cubelic.song-master.v1',
      generated_at: '2026-07-21T18:00:00+09:00',
      songs: [{ song_id: 'song_d1_1', title: 'Integration Song', aliases: [], active: true }],
    }, [audit('song_master.upserted', 'song_d1_1')]);
    const firstGenerated = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    const firstStored = await createCubelicDrafts(db, firstGenerated, firstGenerated.map((draft) => audit('draft.created', draft.draft_id)));

    const replayGenerated = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:50:00+09:00',
    });
    const replayStored = await createCubelicDrafts(db, replayGenerated, replayGenerated.map((draft) => audit('draft.replayed', draft.draft_id)));

    expect(replayStored.map((draft) => draft.draft_id)).toEqual(firstStored.map((draft) => draft.draft_id));
    expect(await listCubelicDrafts(db)).toHaveLength(3);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action IN ('draft.created', 'draft.replayed')").first<{ count: number }>())?.count).toBe(3);

    const approvedInput = {
      draftId: firstStored[0].draft_id,
      accountId: firstStored[0].account_id,
      text: firstStored[0].text,
      mediaAssetIds: [],
      idempotencyKey: firstStored[0].idempotency_key,
      approvedBy: 'integration-operator',
      approvedAt: '2026-07-21T20:55:00+09:00',
    };
    await reserveCubelicDraftApproval(db, firstStored[0].draft_id, 'integration-operator', audit('draft.approval_reserved', firstStored[0].draft_id));
    const handoffs = await Promise.all([
      createCubelicInertDraft(db, 'x_account_row_1', approvedInput),
      createCubelicInertDraft(db, 'x_account_row_1', approvedInput),
    ]);
    const firstHandoff = handoffs.find((handoff) => !handoff.idempotentReplay)!;
    const replayHandoff = handoffs.find((handoff) => handoff.idempotentReplay)!;
    expect(firstHandoff).toBeDefined();
    expect(replayHandoff).toEqual({ ...firstHandoff, idempotentReplay: true });
    await expect(createCubelicInertDraft(db, 'x_account_row_changed', approvedInput)).rejects.toThrow(/canonical payload/);
    await expect(getCubelicInertDraft(db, firstStored[0].draft_id)).resolves.toMatchObject({
      schema_version: 'cubelic.x-harness-inert-draft.v1',
      inbox_id: firstHandoff.inboxId,
      status: 'inert_draft',
      draft_id: firstStored[0].draft_id,
    });
    const inboxAudits = await db.prepare(
      "SELECT entity_id FROM cubelic_audit_logs WHERE action = 'x_harness_inbox.created'",
    ).all<{ entity_id: string }>();
    expect(inboxAudits.results).toEqual([{ entity_id: firstHandoff.inboxId }]);
    await setCubelicOperationWindow(db, {
      eventId: eventFixture.event_id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      actor: 'integration-operator',
    }, audit('system.operation_window_opened', 'operation_window_handoff'));
    await handoffCubelicDraftAndStop(
      db,
      { draftId: firstStored[0].draft_id, actor: 'integration-operator', inboxId: firstHandoff.inboxId },
      {
        draft: audit('draft.approved_and_handed_off', firstStored[0].draft_id),
        operationWindow: audit('system.operation_window_closed_after_handoff', 'operation_window_handoff'),
      },
    );
    await expect(getCubelicEmergencyStop(db)).resolves.toBe(true);
    await expect(getCubelicOperationWindow(db)).resolves.toBeNull();
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing_after_handoff'));

    await createCubelicPublishedPostMapping(db, {
      postId: '1234567890123456789',
      draftId: firstStored[0].draft_id,
      publishedAt: '2026-07-21T21:30:00.000Z',
      createdBy: 'integration-operator',
    }, audit('metrics.post_mapped', '1234567890123456789'));
    await saveCubelicMetrics(db, {
      postId: '1234567890123456789',
      window: '2h',
      values: { ...emptyMetrics(), impressions: 100 },
      collectedAt: '2026-07-21T23:30:00.000Z',
    }, audit('metrics.collected', '1234567890123456789'));
    await expect(getCubelicMetricsSummary(db)).resolves.toEqual([
      expect.objectContaining({
        postId: '1234567890123456789',
        draftId: firstStored[0].draft_id,
        dimensions: expect.objectContaining({ category: firstStored[0].category, eventId: eventFixture.event_id }),
      }),
    ]);
  });

  it('enforces duplicate media hashes, emergency state, and append-only audit records', async () => {
    expect(await getCubelicEmergencyStop(db)).toBe(true);
    await db.prepare("DELETE FROM cubelic_system_flags WHERE key = 'emergency_stop'").run();
    expect(await getCubelicEmergencyStop(db)).toBe(true);
    await expect(createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id))).rejects.toThrow(/emergency stop active/);
    await db.prepare("INSERT INTO cubelic_system_flags (key, value, updated_at, updated_by) VALUES ('emergency_stop', 'invalid', ?, ?)")
      .bind(new Date().toISOString(), 'integration-tamper').run();
    expect(await getCubelicEmergencyStop(db)).toBe(true);
    await expect(createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id))).rejects.toThrow(/emergency stop active/);
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing'));
    expect(await getCubelicEmergencyStop(db)).toBe(false);
    await createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id));
    await createCubelicMedia(db, mediaFixture, [], audit('media.created', mediaFixture.asset_id));
    await expect(createCubelicMedia(db, { ...mediaFixture, asset_id: 'ast_duplicate' }, [], audit('media.created', 'ast_duplicate'))).rejects.toThrow(/UNIQUE/);

    await setCubelicEmergencyStop(db, true, 'integration-operator', audit('system.emergency_stop', 'publishing'));
    expect(await getCubelicEmergencyStop(db)).toBe(true);
    const blockedEvent = { ...eventFixture, event_id: 'evt_blocked_after_stop' };
    await expect(createCubelicEvent(db, blockedEvent, audit('event.created', blockedEvent.event_id))).rejects.toThrow(/emergency stop active/);
    expect(await db.prepare('SELECT event_id FROM cubelic_events WHERE event_id = ?').bind(blockedEvent.event_id).first()).toBeNull();

    await appendCubelicAudit(db, {
      actor: 'human',
      action: 'integration.checked',
      entityType: 'system',
      entityId: 'phase1',
      before: {},
      after: { safe: true },
      correlationId: 'corr_integration_1',
    });
    await expect(db.prepare("UPDATE cubelic_audit_logs SET action = 'tampered'").run()).rejects.toThrow(/append-only/);
    await expect(db.prepare('DELETE FROM cubelic_audit_logs').run()).rejects.toThrow(/append-only/);
  });

  it('serializes competing draft decisions and prevents edits after approval reservation', async () => {
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing'));
    await createCubelicEvent(db, eventFixture, audit('event.created', eventFixture.event_id));
    await createCubelicContent(db, contentFixture, audit('content.created', contentFixture.content_id));
    await upsertCubelicSongMaster(db, {
      schema_version: 'cubelic.song-master.v1',
      generated_at: '2026-07-21T18:00:00+09:00',
      songs: [{ song_id: 'song_d1_1', title: 'Integration Song', aliases: [], active: true }],
    }, [audit('song_master.upserted', 'song_d1_1')]);
    const generated = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    const drafts = await createCubelicDrafts(db, generated, generated.map((draft) => audit('draft.created', draft.draft_id)));
    const contested = drafts[0];
    const results = await Promise.allSettled([
      reserveCubelicDraftApproval(db, contested.draft_id, 'approver', audit('draft.approval_reserved', contested.draft_id)),
      setCubelicDraftDecision(
        db,
        { draftId: contested.draft_id, status: 'rejected', actor: 'reviewer', rejectReason: 'manual_rejection' },
        audit('draft.rejected', contested.draft_id),
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = (await listCubelicDrafts(db)).find((draft) => draft.draft_id === contested.draft_id);
    expect(['approved', 'rejected']).toContain(stored?.approval_status);
    const decisionAudits = await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE entity_id = ? AND action IN ('draft.approval_reserved', 'draft.rejected')",
    ).bind(contested.draft_id).first<{ count: number }>();
    expect(decisionAudits?.count).toBe(1);
    await expect(reserveCubelicDraftApproval(db, contested.draft_id, 'second-approver', audit('draft.approval_reserved', contested.draft_id)))
      .rejects.toThrow(/transition/);

    const editRace = drafts[1];
    await reserveCubelicDraftApproval(db, editRace.draft_id, 'approver', audit('draft.approval_reserved', editRace.draft_id));
    await expect(updateCubelicDraftText(db, editRace.draft_id, 'late edit', audit('draft.text_updated', editRace.draft_id)))
      .rejects.toThrow(/immutable/);
    const editAudit = await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE entity_id = ? AND action = 'draft.text_updated'",
    ).bind(editRace.draft_id).first<{ count: number }>();
    expect(editAudit?.count).toBe(0);
    await expect(upsertCubelicSongMaster(db, {
      schema_version: 'cubelic.song-master.v1',
      generated_at: '2026-07-21T19:00:00+09:00',
      songs: [{ song_id: 'song_d1_1', title: 'Integration Song', aliases: [], active: false }],
    }, [audit('song_master.upserted', 'song_d1_1')])).rejects.toThrow(/frozen/);

    await expect(setCubelicDraftDecision(
      db,
      { draftId: editRace.draft_id, status: 'handed_off', actor: 'approver', inboxId: 'xin_missing' },
      audit('draft.approved_and_handed_off', editRace.draft_id),
    )).rejects.toThrow(/matching inert inbox/);
    const editRaceInbox = await createCubelicInertDraft(db, 'x_account_row_1', {
      draftId: editRace.draft_id,
      accountId: editRace.account_id,
      text: editRace.text,
      mediaAssetIds: editRace.media_asset_ids,
      idempotencyKey: editRace.idempotency_key,
      approvedBy: 'approver',
      approvedAt: '2026-07-21T20:56:00+09:00',
    });
    const handoffs = await Promise.allSettled([
      setCubelicDraftDecision(db, { draftId: editRace.draft_id, status: 'handed_off', actor: 'approver', inboxId: editRaceInbox.inboxId }, audit('draft.approved_and_handed_off', editRace.draft_id)),
      setCubelicDraftDecision(db, { draftId: editRace.draft_id, status: 'handed_off', actor: 'approver', inboxId: editRaceInbox.inboxId }, audit('draft.approved_and_handed_off', editRace.draft_id)),
    ]);
    expect(handoffs.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const handoffAudits = await db.prepare(
      "SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE entity_id = ? AND action = 'draft.approved_and_handed_off'",
    ).bind(editRace.draft_id).first<{ count: number }>();
    expect(handoffAudits?.count).toBe(1);
  });

  it('rolls back state when its audit statement fails', async () => {
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing'));
    const invalidAudit = { ...audit('event.created', eventFixture.event_id), actor: 'invalid' } as unknown as AuditInput;
    await expect(createCubelicEvent(db, eventFixture, invalidAudit)).rejects.toThrow();
    expect(await db.prepare('SELECT event_id FROM cubelic_events WHERE event_id = ?').bind(eventFixture.event_id).first()).toBeNull();
  });

  it('deduplicates concurrent rejection retries without false creation audits', async () => {
    await setCubelicEmergencyStop(db, false, 'integration-operator', audit('system.emergency_resume', 'publishing'));
    const rejection = {
      actor: 'hermes' as const,
      reasons: ['rights_unconfirmed' as const],
      requestMethod: 'POST',
      requestPath: '/api/cubelic/media/validate',
      correlationId: 'corr_rejection_retry',
    };
    await Promise.all([recordCubelicRejections(db, rejection), recordCubelicRejections(db, rejection)]);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cubelic_rejection_events WHERE correlation_id = 'corr_rejection_retry'").first<{ count: number }>())?.count).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cubelic_audit_logs WHERE action = 'rejection.recorded' AND correlation_id = 'corr_rejection_retry'").first<{ count: number }>())?.count).toBe(1);
  });
});
