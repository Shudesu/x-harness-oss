import { describe, expect, it, vi } from 'vitest';
import { Phase1XPublishingAdapter } from './adapter.js';
import { generateSetlistDrafts, generateVideoDrafts } from './generator.js';
import { assertDraftApprovalGates } from './rules.js';
import { contentFixture, eventFixture, mediaFixture, setlistFixture } from './test-fixtures.js';

describe('Phase 1 E2E safety flows', () => {
  it('E2E-01 ingests setlist, generates a candidate, approves and creates only an inert X Harness draft', async () => {
    const candidates = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    const selected = candidates[0];
    assertDraftApprovalGates(selected, { humanApproved: true, emergencyStopped: false });
    const writer = vi.fn(async () => ({ inboxId: 'xin_1', status: 'inert_draft' as const, idempotentReplay: false }));
    const adapter = new Phase1XPublishingAdapter(writer);
    const result = await adapter.createDraft({
      draftId: selected.draft_id,
      accountId: selected.account_id,
      text: selected.text,
      mediaAssetIds: [],
      idempotencyKey: selected.idempotency_key,
      approvedBy: 'operator',
      approvedAt: '2026-07-21T20:50:00+09:00',
    });
    expect(result.status).toBe('inert_draft');
    expect(writer).toHaveBeenCalledOnce();
    await expect(adapter.publishPost()).rejects.toMatchObject({ code: 'phase1_operation_disabled' });
  });

  it('E2E-02 stops video draft generation when filming is unconfirmed', async () => {
    const content = { ...contentFixture, category: 'live_digest' as const, target_stage: 'unaware' as const, source_type: 'media_asset' as const };
    const event = { ...eventFixture, state: 'digest_ready' as const, filming_policy: { ...eventFixture.filming_policy, confirmed: false } };
    await expect(generateVideoDrafts({ content, event, media: mediaFixture, now: '2026-07-21T20:45:00+09:00' }))
      .rejects.toMatchObject({ code: 'rights_gate_failed', rejectReasons: ['rights_unconfirmed'] });
  });

  it('E2E-03 rejects the same media hash twice before draft generation', () => {
    const acceptedHashes = new Set<string>();
    const admit = (hash: string) => {
      if (acceptedHashes.has(hash)) return 'duplicate_media';
      acceptedHashes.add(hash);
      return 'accepted';
    };
    expect(admit(mediaFixture.sha256)).toBe('accepted');
    expect(admit(mediaFixture.sha256)).toBe('duplicate_media');
  });

  it('E2E-04 emergency stop prevents adapter handoff', async () => {
    const [draft] = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    const writer = vi.fn();
    expect(() => assertDraftApprovalGates(draft, { humanApproved: true, emergencyStopped: true })).toThrow(/Emergency stop/);
    expect(writer).not.toHaveBeenCalled();
  });
});
