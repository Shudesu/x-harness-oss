import { describe, expect, it } from 'vitest';
import { ContentPolicyError } from './errors.js';
import {
  assertDraftableEventState,
  assertEventTransition,
  assertMediaPath,
  assertSha256,
  buildTrackedUrl,
  calculateFreshnessScore,
  calculateQualityScore,
  evaluateRights,
  isDuplicateText,
  isRejectReason,
  textSimilarity,
  validatePostText,
} from './rules.js';
import { contentFixture, eventFixture, mediaFixture, passingQuality } from './test-fixtures.js';

describe('UTM generation', () => {
  it('sets canonical values and preserves existing query fields', () => {
    const url = new URL(buildTrackedUrl({
      baseUrl: 'https://cubelic-fan.com/events/evt?lang=ja',
      campaignId: 'evt_1',
      category: 'event_notice',
      templateId: 'v1',
      variant: 'a',
    }));
    expect(url.searchParams.get('lang')).toBe('ja');
    expect(url.searchParams.get('utm_source')).toBe('x');
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('evt_1');
    expect(url.searchParams.get('utm_content')).toBe('event_notice_v1_a');
  });

  it('rejects non-HTTPS destinations', () => {
    expect(() => buildTrackedUrl({ baseUrl: 'http://example.com', campaignId: 'x', category: 'event_notice', templateId: 'v1', variant: 'a' })).toThrow(ContentPolicyError);
  });
});

describe('post text policy', () => {
  it('accepts a valid post', () => {
    expect(validatePostText('今日のライブをまとめました。\n#CUBΣLIC')).toMatchObject({ hashtags: ['CUBΣLIC'] });
  });

  it('enforces character, hashtag, banned phrase and punctuation limits', () => {
    expect(validatePostText('a'.repeat(280))).toMatchObject({ weightedLength: 280 });
    expect(validatePostText('あ'.repeat(140))).toMatchObject({ weightedLength: 280 });
    expect(() => validatePostText('あ'.repeat(141))).toThrow(/weighted/);
    expect(() => validatePostText('#a #b #c #d')).toThrow(/hashtags/);
    expect(() => validatePostText('これは必見です')).toThrow(/prohibited/);
    expect(() => validatePostText('わあ！！！')).toThrow(/exclamation/);
    expect(() => validatePostText('ライブ最高😀🎉✨')).toThrow(/emoji/);
    expect(validatePostText('ライブ最高😀🎉')).toMatchObject({ hashtags: [] });
    expect(validatePostText('家族で応援👨‍👩‍👧‍👦')).toMatchObject({ hashtags: [] });
    expect(() => validatePostText('応援🇯🇵🇺🇸🇬🇧')).toThrow(/emoji/);
    expect(() => validatePostText('番号1️⃣2️⃣3️⃣')).toThrow(/emoji/);
  });
});

describe('duplicate detection', () => {
  it('normalizes punctuation and spacing', () => {
    expect(textSimilarity('今日のライブ、最高でした', '今日のライブ 最高でした！')).toBeGreaterThan(0.82);
    expect(isDuplicateText('今日のライブ、最高でした', ['今日のライブ 最高でした！'])).toBe(true);
    expect(isDuplicateText('次のライブ予定です', ['セトリを公開しました'])).toBe(false);
  });
});

describe('rights gate', () => {
  it('passes confirmed evidence and completed privacy review', () => {
    expect(evaluateRights(eventFixture, mediaFixture)).toMatchObject({ passed: true, rejectReasons: [] });
  });

  it('fails closed for rights, scope and third-party review', () => {
    const event = structuredClone(eventFixture);
    const media = structuredClone(mediaFixture);
    event.filming_policy.confirmed = false;
    event.filming_policy.scope = 'unknown';
    media.privacy.audience_visible = true;
    media.privacy.manual_review_completed = false;
    expect(evaluateRights(event, media)).toMatchObject({
      passed: false,
      rejectReasons: expect.arrayContaining(['rights_unconfirmed', 'filming_scope_unknown', 'third_party_visible']),
    });
  });

  it('fails closed when confirmation is not attributed to a human operator', () => {
    const event = structuredClone(eventFixture);
    event.filming_policy.confirmed_by = null;
    expect(evaluateRights(event, mediaFixture)).toMatchObject({ passed: false, rejectReasons: ['rights_unconfirmed'] });
  });
});

describe('event state transitions', () => {
  it('allows only the next state or an idempotent replay', () => {
    expect(() => assertEventTransition('ended', 'setlist_confirmed')).not.toThrow();
    expect(() => assertEventTransition('ended', 'ended')).not.toThrow();
    expect(() => assertEventTransition('ended', 'archived')).toThrow(/cannot transition/);
    expect(() => assertEventTransition('ended', 'in_progress')).toThrow(/cannot transition/);
  });

  it('fails closed when a category is drafted outside its allowed event state', () => {
    expect(() => assertDraftableEventState(contentFixture, eventFixture)).not.toThrow();
    expect(() => assertDraftableEventState(
      { ...contentFixture, category: 'live_digest' },
      eventFixture,
    )).toThrow(/cannot be drafted/);
    expect(() => assertDraftableEventState(
      { ...contentFixture, category: 'live_digest' },
      { ...eventFixture, state: 'digest_ready' },
    )).not.toThrow();
  });
});

describe('quality and freshness', () => {
  it('totals bounded axes', () => {
    expect(calculateQualityScore(passingQuality)).toBe(85);
    expect(() => calculateQualityScore({ ...passingQuality, accuracy: 21 })).toThrow(/accuracy/);
  });

  it('uses the normative freshness buckets', () => {
    const ended = '2026-07-21T20:30:00+09:00';
    expect(calculateFreshnessScore(ended, '2026-07-21T21:00:00+09:00')).toBe(100);
    expect(calculateFreshnessScore(ended, '2026-07-21T22:30:00+09:00')).toBe(85);
    expect(calculateFreshnessScore(ended, '2026-07-23T20:31:00+09:00')).toBe(10);
  });
});

describe('reject reasons and media metadata', () => {
  it('accepts only structured reject reasons', () => {
    expect(isRejectReason('duplicate_media')).toBe(true);
    expect(isRejectReason('guess')).toBe(false);
  });

  it('rejects path traversal and malformed hashes', () => {
    expect(() => assertMediaPath('/exports/clip.mp4')).not.toThrow();
    expect(() => assertMediaPath('/exports/../secret')).toThrow(/traversal/);
    expect(() => assertSha256('a'.repeat(64))).not.toThrow();
    expect(() => assertSha256('abc')).toThrow(/64/);
  });
});
