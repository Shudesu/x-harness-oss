import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import { Phase1XPublishingAdapter, type XDraftInput } from '@x-harness/content-os';
import { createCubelicInertDraft, getCubelicEmergencyStop, setCubelicEmergencyStop, setCubelicOperationWindow } from '@x-harness/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubelic } from './cubelic.js';
import type { Env } from '../index.js';
import { compileMigrationForD1Exec } from '../../../../packages/db/src/d1-test-utils.js';

const migrationPaths = [
  fileURLToPath(new URL('../../../../packages/db/migrations/018-cubelic-content-os.sql', import.meta.url)),
  fileURLToPath(new URL('../../../../packages/db/migrations/019-cubelic-fail-closed-boundaries.sql', import.meta.url)),
];

describe('CUBΣLIC Worker API integration', () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let app: Hono<Env>;
  let bindings: Env['Bindings'];
  let createDraft: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: '2024-12-01',
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: { DB: 'cubelic-api-integration-test' },
    });
    db = await miniflare.getD1Database('DB') as unknown as D1Database;
    for (const migrationPath of migrationPaths) {
      await db.exec(compileMigrationForD1Exec(await readFile(migrationPath, 'utf8')));
    }
    await setCubelicEmergencyStop(db, false, 'integration-operator', {
      actor: 'human',
      action: 'system.emergency_resume',
      entityType: 'system',
      entityId: 'publishing',
      before: { stopped: true },
      after: { stopped: false },
      correlationId: 'corr_integration_resume',
    });
    bindings = {
      DB: db,
      API_KEY: 'integration-api-key',
      X_ACCESS_TOKEN: '',
      X_REFRESH_TOKEN: '',
      WORKER_URL: 'https://worker.example.test',
      CUBELIC_SAFE_MODE: 'true',
      GLOBAL_PUBLISHING_DISABLED: 'false',
      HUMAN_APPROVAL_KEY: 'integration-human-key',
      HERMES_ACCESS_TOKEN: 'integration-hermes-key',
      X_HARNESS_ACCOUNT_ID: 'x_account_row_integration',
    };
    app = new Hono<Env>();
    createDraft = vi.fn(async (input: XDraftInput) => createCubelicInertDraft(db, bindings.X_HARNESS_ACCOUNT_ID!, input));
    app.use('*', async (c, next) => {
      const requestActor = c.req.header('X-Test-Actor') === 'hermes' ? 'hermes' : 'human';
      if (requestActor === 'human') {
        c.set('staffRole', 'admin');
        c.set('staffName', 'Integration Operator');
      }
      c.set('requestActor', requestActor);
      c.set('cubelicAdapterFactory', () => new Phase1XPublishingAdapter(createDraft));
      return next();
    });
    app.route('/', cubelic);
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return app.request(`https://worker.example.test${path}`, init, bindings);
  }

  async function openWindow(eventId: string): Promise<void> {
    await setCubelicOperationWindow(db, {
      eventId,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      actor: 'integration-operator',
    }, {
      actor: 'human',
      action: 'system.operation_window_opened',
      entityType: 'system',
      entityId: 'operation_window',
      before: {},
      after: { eventId },
      correlationId: `corr_window_${eventId}`,
    });
  }

  it('keeps every non-metrics write stopped while the environment emergency stop is active', async () => {
    bindings.GLOBAL_PUBLISHING_DISABLED = 'true';

    const resume = await request('/api/cubelic/admin/emergency-resume', {
      method: 'POST',
      headers: { 'X-Human-Approval-Key': 'integration-human-key' },
      body: '{}',
    });
    expect(resume.status).toBe(423);

    const response = await request('/api/cubelic/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(423);
    await expect((await request('/api/cubelic/admin/status')).json()).resolves.toMatchObject({
      data: {
        environmentStop: true,
        emergencyStop: false,
        publishingEnabled: false,
        schedulingEnabled: false,
      },
    });
  });

  it('opens an event window only with an explicit environment resume and rejects replacement', async () => {
    bindings.GLOBAL_PUBLISHING_DISABLED = undefined;
    const requestWindow = () => request('/api/cubelic/admin/operation-window', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify({ eventId: 'evt_window_api', durationMinutes: 15 }),
    });
    expect((await requestWindow()).status).toBe(423);

    bindings.GLOBAL_PUBLISHING_DISABLED = 'false';
    expect((await requestWindow()).status).toBe(201);
    expect((await requestWindow()).status).toBe(409);
    await expect((await request('/api/cubelic/admin/status')).json()).resolves.toMatchObject({
      data: {
        operationWindow: { eventId: 'evt_window_api', active: true },
      },
    });
  });

  it('rejects expired and cross-event operation-window writes', async () => {
    const event = {
      event_id: 'evt_window_allowed',
      title: 'WINDOW TEST',
      venue: 'TEST VENUE',
      starts_at: new Date(Date.now() - 90 * 60_000).toISOString(),
      ends_at: new Date(Date.now() - 15 * 60_000).toISOString(),
      state: 'ended',
      event_tags: [],
      filming_policy: { confirmed: false, scope: 'unknown', evidence_type: null, evidence_url: null, confirmed_at: null, confirmed_by: null },
    };
    await openWindow(event.event_id);
    const mismatch = await request('/api/cubelic/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...event, event_id: 'evt_window_other' }),
    });
    expect(mismatch.status).toBe(423);

    await setCubelicOperationWindow(db, {
      eventId: event.event_id,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      actor: 'integration-operator',
    }, {
      actor: 'human',
      action: 'system.operation_window_expired_fixture',
      entityType: 'system',
      entityId: 'operation_window',
      before: {},
      after: { eventId: event.event_id },
      correlationId: 'corr_window_expired',
    });
    expect((await request('/api/cubelic/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })).status).toBe(423);
    expect(await getCubelicEmergencyStop(db)).toBe(true);
  });

  it('requires human proof for initial media review and atomically records blocked-media reasons', async () => {
    const now = Date.now();
    const event = {
      event_id: 'evt_media_review',
      title: 'MEDIA REVIEW TEST',
      venue: 'TEST VENUE',
      starts_at: new Date(now - 90 * 60_000).toISOString(),
      ends_at: new Date(now - 15 * 60_000).toISOString(),
      state: 'digest_ready',
      event_tags: [],
      filming_policy: {
        confirmed: true,
        scope: 'full_event',
        evidence_type: 'staff_confirmation',
        evidence_url: 'https://example.test/evidence/media',
        confirmed_at: new Date(now - 20 * 60_000).toISOString(),
        confirmed_by: 'human_operator',
      },
    };
    await openWindow(event.event_id);
    expect((await request('/api/cubelic/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify(event),
    })).status).toBe(201);

    const media = {
      asset_id: 'ast_media_review',
      event_id: event.event_id,
      path: '/exports/media-review.mp4',
      sha256: 'c'.repeat(64),
      duration_seconds: 15,
      orientation: 'vertical',
      resolution: '1080x1920',
      audio_present: true,
      rights: { filming_policy_confirmed: true, publishing_allowed: true, evidence_url: 'https://example.test/evidence/media', song_scope_confirmed: true },
      privacy: { audience_visible: true, third_party_faces_detected: false, manual_review_completed: false, cropping_required: false, blurring_required: false },
      quality: { video_ok: true, audio_ok: true, sync_ok: true, score: 90 },
    };
    expect((await request('/api/cubelic/media/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(media),
    })).status).toBe(403);
    const blocked = await request('/api/cubelic/media/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify(media),
    });
    expect(blocked.status).toBe(422);
    expect(await db.prepare("SELECT asset_id FROM cubelic_media_assets WHERE asset_id = 'ast_media_review' AND status = 'blocked'").first()).not.toBeNull();
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cubelic_rejection_events WHERE reason = 'third_party_visible'").first<{ count: number }>())?.count).toBe(1);
  });

  it('runs setlist to inert handoff and then stops all non-metrics writes', async () => {
    const now = Date.now();
    const event = {
      event_id: 'evt_api_integration',
      title: 'CUBΣLIC API TEST',
      venue: 'TEST VENUE',
      starts_at: new Date(now - 90 * 60_000).toISOString(),
      ends_at: new Date(now - 15 * 60_000).toISOString(),
      state: 'ended',
      event_tags: [],
      filming_policy: { confirmed: false, scope: 'unknown', evidence_type: null, evidence_url: null, confirmed_at: null, confirmed_by: null },
    };
    await openWindow(event.event_id);
    expect((await request('/api/cubelic/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
    })).status).toBe(201);
    await openWindow('evt_hermes_rights_claim');
    const hermesRightsClaim = await request('/api/cubelic/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Test-Actor': 'hermes' },
      body: JSON.stringify({
        ...event,
        event_id: 'evt_hermes_rights_claim',
        filming_policy: {
          confirmed: true,
          scope: 'full_event',
          evidence_type: 'staff_confirmation',
          evidence_url: 'https://example.test/evidence/1',
          confirmed_at: new Date(now - 20 * 60_000).toISOString(),
          confirmed_by: 'human_operator',
        },
      }),
    });
    expect(hermesRightsClaim.status).toBe(403);
    expect(await db.prepare("SELECT event_id FROM cubelic_events WHERE event_id = 'evt_hermes_rights_claim'").first()).toBeNull();
    const humanRightsEvent = {
      ...event,
      event_id: 'evt_human_rights_claim',
      filming_policy: {
        confirmed: true,
        scope: 'full_event',
        evidence_type: 'staff_confirmation',
        evidence_url: 'https://example.test/evidence/2',
        confirmed_at: new Date(now - 20 * 60_000).toISOString(),
        confirmed_by: 'human_operator',
      },
    };
    await openWindow(humanRightsEvent.event_id);
    expect((await request('/api/cubelic/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(humanRightsEvent),
    })).status).toBe(403);
    expect((await request('/api/cubelic/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify(humanRightsEvent),
    })).status).toBe(201);
    await openWindow(event.event_id);

    const referencedContent = {
      content_id: 'cnt_reference_check',
      event_id: event.event_id,
      category: 'song_focus',
      target_stage: 'interested',
      content_lifecycle: { type: 'hybrid', expires_at: null },
      status: 'validated',
      source_type: 'manual',
      source_refs: ['integration'],
      member_ids: [],
      song_ids: ['song_api_1'],
      emotion_tags: ['informative'],
      destination: { type: 'song_page', base_url: 'https://example.test/songs/song_api_1', tracked_url: '' },
    };
    const unknownContent = await request('/api/cubelic/content', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(referencedContent),
    });
    expect(unknownContent.status).toBe(422);
    await expect(unknownContent.json()).resolves.toMatchObject({ rejectReasons: ['song_unknown'] });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM cubelic_rejection_events WHERE reason = 'song_unknown'").first<{ count: number }>())?.count).toBe(1);

    const setlist = {
      schema_version: 'cubelic.gas-setlist.v1',
      event_id: event.event_id,
      event_title: event.title,
      venue: event.venue,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      lp_url: 'https://example.test/setlists/evt_api_integration',
      confirmed_at: new Date(now - 10 * 60_000).toISOString(),
      confirmed_by: 'Integration Operator',
      songs: [{ position: 1, song_id: 'song_api_1', title: 'API Integration Song' }],
    };
    expect((await request('/api/cubelic/setlists/ingest', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(setlist),
    })).status).toBe(422);

    const masterResponse = await request('/api/cubelic/masters/songs/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify({
        schema_version: 'cubelic.song-master.v1',
        generated_at: '2026-07-21T18:00:00+09:00',
        songs: [{ song_id: 'song_api_1', title: 'API Integration Song', aliases: [], active: true }],
      }),
    });
    expect(masterResponse.status).toBe(201);
    expect((await request('/api/cubelic/content', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(referencedContent),
    })).status).toBe(201);

    const setlistResponse = await request('/api/cubelic/setlists/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(setlist),
    });
    expect(setlistResponse.status).toBe(201);
    const setlistBody = await setlistResponse.json() as { data: { drafts: Array<{ draft_id: string }> } };
    expect(setlistBody.data.drafts).toHaveLength(3);
    const draftId = setlistBody.data.drafts[0].draft_id;

    expect((await request(`/api/cubelic/drafts/${draftId}/approve`, { method: 'POST', body: '{}' })).status).toBe(403);
    await db.prepare("UPDATE cubelic_songs SET active = 0 WHERE song_id = 'song_api_1'").run();
    expect((await request(`/api/cubelic/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: '{}',
    })).status).toBe(422);
    expect(createDraft).not.toHaveBeenCalled();
    await db.prepare("UPDATE cubelic_songs SET active = 1 WHERE song_id = 'song_api_1'").run();
    const approval = await request(`/api/cubelic/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: '{}',
    });
    expect(approval.status).toBe(200);
    const approvalBody = await approval.json() as { data: { xHarnessDraft: { status: string } } };
    expect(approvalBody.data.xHarnessDraft.status).toBe('inert_draft');
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cubelic_x_draft_inbox').first<{ count: number }>())?.count).toBe(1);
    expect(await getCubelicEmergencyStop(db)).toBe(true);

    await openWindow(event.event_id);
    expect((await request('/api/cubelic/admin/emergency-resume', {
      method: 'POST',
      headers: { 'X-Human-Approval-Key': 'integration-human-key' },
      body: '{}',
    })).status).toBe(200);

    const rejectedDraftId = setlistBody.data.drafts[1].draft_id;
    expect((await request(`/api/cubelic/drafts/${rejectedDraftId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify({ reason: 'manual_rejection' }),
    })).status).toBe(200);
    const rejectionSummary = await (await request('/api/cubelic/rejections/summary')).json() as { data: Array<{ reason: string; count: number }> };
    expect(rejectionSummary.data).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'manual_rejection', count: 1 })]));

    const postId = '1234567890123456789';
    expect((await request('/api/cubelic/metrics/post-mappings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Human-Approval-Key': 'integration-human-key' },
      body: JSON.stringify({ draftId, postId, publishedAt: '2026-07-21T22:00:00+09:00' }),
    })).status).toBe(201);
    expect((await request('/api/cubelic/metrics/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId, window: '2h' }),
    })).status).toBe(201);
    const summary = await (await request('/api/cubelic/metrics/summary')).json() as { data: Array<{ draftId: string; dimensions: { eventId: string } }> };
    expect(summary.data).toEqual([expect.objectContaining({ draftId, dimensions: expect.objectContaining({ eventId: event.event_id }) })]);

    const stop = await request('/api/cubelic/admin/emergency-stop', {
      method: 'POST', headers: { 'X-Human-Approval-Key': 'integration-human-key' }, body: '{}',
    });
    expect(stop.status).toBe(200);
    expect((await request('/api/cubelic/content', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(423);
  });
});
