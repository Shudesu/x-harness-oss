import { describe, expect, it } from 'vitest';
import { ContentPolicyError } from './errors.js';
import { generateSetlistDrafts, generateVideoDrafts } from './generator.js';
import { contentFixture, eventFixture, mediaFixture, setlistFixture } from './test-fixtures.js';

describe('draft generation', () => {
  it('generates no more than three setlist variants with stages, category and UTM', async () => {
    const drafts = await generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    expect(drafts).toHaveLength(3);
    expect(drafts.every((item) => item.category === 'setlist_flash' && item.target_stage === 'interested')).toBe(true);
    expect(drafts.every((item) => item.destination_url.includes('utm_source=x'))).toBe(true);
    expect(new Set(drafts.map((item) => item.idempotency_key)).size).toBe(3);
    expect(drafts.every((item) => item.approval_status === 'pending_review')).toBe(true);
  });

  it('blocks unknown songs and inconsistent event state', async () => {
    await expect(generateSetlistDrafts({
      setlist: { ...setlistFixture, songs: [] },
      content: contentFixture,
      event: eventFixture,
      now: '2026-07-21T20:45:00+09:00',
    })).rejects.toBeInstanceOf(ContentPolicyError);

    await expect(generateSetlistDrafts({
      setlist: setlistFixture,
      content: contentFixture,
      event: { ...eventFixture, state: 'ended' },
      now: '2026-07-21T20:45:00+09:00',
    })).rejects.toMatchObject({ code: 'event_state_mismatch' });
  });

  it('generates video variants only after rights pass', async () => {
    const content = { ...contentFixture, category: 'live_digest' as const, target_stage: 'unaware' as const, source_type: 'media_asset' as const };
    const digestReadyEvent = { ...eventFixture, state: 'digest_ready' as const };
    const drafts = await generateVideoDrafts({
      content,
      event: digestReadyEvent,
      media: mediaFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    expect(drafts).toHaveLength(3);
    expect(drafts.every((item) => item.rights_gate === 'passed' && item.media_asset_ids[0] === mediaFixture.asset_id)).toBe(true);
    expect(drafts[0].risks).toEqual(expect.arrayContaining([
      expect.stringContaining(digestReadyEvent.filming_policy.evidence_url!),
      expect.stringContaining(mediaFixture.rights.evidence_url),
    ]));
    const changedMedia = await generateVideoDrafts({
      content,
      event: digestReadyEvent,
      media: { ...mediaFixture, sha256: 'b'.repeat(64) },
      now: '2026-07-21T20:45:00+09:00',
    });
    expect(changedMedia[0].idempotency_key).not.toBe(drafts[0].idempotency_key);
  });

  it('records fail-closed reasons when video rights are unconfirmed', async () => {
    const content = { ...contentFixture, category: 'live_digest' as const, target_stage: 'unaware' as const, source_type: 'media_asset' as const };
    const event = structuredClone(eventFixture);
    event.state = 'digest_ready';
    event.filming_policy.confirmed = false;
    await expect(generateVideoDrafts({
      content,
      event,
      media: mediaFixture,
      now: '2026-07-21T20:45:00+09:00',
    })).rejects.toMatchObject({ code: 'rights_gate_failed', rejectReasons: ['rights_unconfirmed'] });
  });

  it('blocks video generation outside digest_ready and selects a category-specific template', async () => {
    const memberContent = { ...contentFixture, category: 'member_focus' as const, target_stage: 'aware' as const, source_type: 'media_asset' as const };
    await expect(generateVideoDrafts({
      content: memberContent,
      event: eventFixture,
      media: mediaFixture,
      now: '2026-07-21T20:45:00+09:00',
    })).rejects.toMatchObject({ code: 'event_state_mismatch' });

    const drafts = await generateVideoDrafts({
      content: memberContent,
      event: { ...eventFixture, state: 'digest_ready' },
      media: mediaFixture,
      now: '2026-07-21T20:45:00+09:00',
    });
    expect(drafts.every((draft) => draft.template_id === 'member_focus_v1')).toBe(true);
    await expect(generateVideoDrafts({
      content: memberContent,
      event: { ...eventFixture, state: 'digest_ready' },
      media: { ...mediaFixture, event_id: 'evt_other' },
      now: '2026-07-21T20:45:00+09:00',
    })).rejects.toMatchObject({ code: 'media_event_mismatch' });
  });
});
