import { calculateFreshnessScore, calculateQualityScore } from './rules.js';
import type { ContentItem, EventRecord, GasSetlistV1, MediaAsset, QualityBreakdown } from './types.js';

type Variant = 'a' | 'b' | 'c';

function freshnessAxis(event: EventRecord, now: string): number {
  return Math.round(calculateFreshnessScore(event.ends_at, now) * 0.15);
}

function routeAxis(content: ContentItem): number {
  try {
    return new URL(content.destination.base_url).protocol === 'https:' ? 10 : 0;
  } catch {
    return 0;
  }
}

export function scoreSetlistDraft(input: {
  setlist: GasSetlistV1;
  content: ContentItem;
  event: EventRecord;
  variant: Variant;
  now: string;
}): QualityBreakdown {
  const songCount = input.setlist.songs.length;
  const breakdown: QualityBreakdown = {
    accuracy: input.event.state === 'setlist_confirmed' || input.event.state === 'digest_ready' || input.event.state === 'archived' ? 20 : 0,
    freshness: freshnessAxis(input.event, input.now),
    rarity: Math.min(15, 10 + Math.ceil(songCount / 3)),
    newcomer_clarity: ({ a: 12, b: 13, c: 15 } as const)[input.variant],
    appeal: Math.min(15, 8 + songCount),
    route_clarity: routeAxis(input.content),
    conversation_shareability: ({ a: 8, b: 7, c: 8 } as const)[input.variant],
  };
  calculateQualityScore(breakdown);
  return breakdown;
}

export function scoreVideoDraft(input: {
  content: ContentItem;
  event: EventRecord;
  media: MediaAsset;
  variant: Variant;
  now: string;
}): QualityBreakdown {
  const breakdown: QualityBreakdown = {
    accuracy: input.media.status === 'approved_for_draft' ? 20 : 0,
    freshness: freshnessAxis(input.event, input.now),
    rarity: Math.min(15, 10 + (input.media.duration_seconds <= 60 ? 3 : 1) + (input.media.orientation === 'vertical' ? 1 : 0)),
    newcomer_clarity: ({ a: 11, b: 12, c: 15 } as const)[input.variant],
    appeal: Math.round(input.media.quality.score * 0.15),
    route_clarity: routeAxis(input.content),
    conversation_shareability: ({ a: 7, b: 8, c: 8 } as const)[input.variant],
  };
  calculateQualityScore(breakdown);
  return breakdown;
}
