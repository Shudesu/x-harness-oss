import { describe, expect, it } from 'vitest';
import { calculateQualityScore } from './rules.js';
import { scoreSetlistDraft, scoreVideoDraft } from './scoring.js';
import { contentFixture, eventFixture, mediaFixture, setlistFixture } from './test-fixtures.js';

describe('evidence-derived content scoring', () => {
  it('changes setlist scores by freshness, song count and variant clarity', () => {
    const fresh = scoreSetlistDraft({ setlist: setlistFixture, content: contentFixture, event: eventFixture, variant: 'a', now: '2026-07-21T20:45:00+09:00' });
    const stale = scoreSetlistDraft({ setlist: { ...setlistFixture, songs: setlistFixture.songs.slice(0, 1) }, content: contentFixture, event: eventFixture, variant: 'a', now: '2026-07-24T20:45:00+09:00' });
    const newcomer = scoreSetlistDraft({ setlist: setlistFixture, content: contentFixture, event: eventFixture, variant: 'c', now: '2026-07-21T20:45:00+09:00' });

    expect(fresh.freshness).toBe(15);
    expect(stale.freshness).toBe(2);
    expect(calculateQualityScore(fresh)).toBeGreaterThan(calculateQualityScore(stale));
    expect(newcomer.newcomer_clarity).toBeGreaterThan(fresh.newcomer_clarity);
  });

  it('derives video appeal from inspected media quality', () => {
    const strong = scoreVideoDraft({ content: { ...contentFixture, category: 'live_digest' }, event: eventFixture, media: mediaFixture, variant: 'b', now: '2026-07-21T20:45:00+09:00' });
    const weak = scoreVideoDraft({ content: { ...contentFixture, category: 'live_digest' }, event: eventFixture, media: { ...mediaFixture, quality: { ...mediaFixture.quality, score: 65 } }, variant: 'b', now: '2026-07-21T20:45:00+09:00' });

    expect(strong.appeal).toBeGreaterThan(weak.appeal);
    expect(calculateQualityScore(strong)).toBeGreaterThan(calculateQualityScore(weak));
  });
});
