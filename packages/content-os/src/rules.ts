import { ContentPolicyError } from './errors.js';
import { PHASE1_POLICY } from './policy.generated.js';
import twitterText from 'twitter-text';
import {
  CONTENT_CATEGORIES,
  EVENT_STATES,
  FAN_STAGES,
  REJECT_REASONS,
  type ContentItem,
  type ContentCategory,
  type DraftCandidate,
  type EventRecord,
  type EventState,
  type FanStage,
  type MediaAsset,
  type QualityBreakdown,
  type RejectReason,
} from './types.js';

const PROHIBITED_PHRASES = [
  '話題沸騰',
  '絶対',
  '必見',
  '公式です',
  '公式アカウント',
  '人気No.1',
] as const;

const SCORE_LIMITS: Record<keyof QualityBreakdown, number> = {
  accuracy: 20,
  freshness: 15,
  rarity: 15,
  newcomer_clarity: 15,
  appeal: 15,
  route_clarity: 10,
  conversation_shareability: 10,
};

export function isEventState(value: unknown): value is EventState {
  return typeof value === 'string' && EVENT_STATES.includes(value as EventState);
}

export function isFanStage(value: unknown): value is FanStage {
  return typeof value === 'string' && FAN_STAGES.includes(value as FanStage);
}

export function isContentCategory(value: unknown): value is ContentCategory {
  return typeof value === 'string' && CONTENT_CATEGORIES.includes(value as ContentCategory);
}

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === 'string' && REJECT_REASONS.includes(value as RejectReason);
}

export function canTransitionEvent(from: EventState, to: EventState): boolean {
  if (from === to) return true;
  return EVENT_STATES.indexOf(to) === EVENT_STATES.indexOf(from) + 1;
}

export function assertEventTransition(from: EventState, to: EventState): void {
  if (!canTransitionEvent(from, to)) {
    throw new ContentPolicyError('invalid_event_transition', `Event cannot transition from ${from} to ${to}`, ['incorrect_metadata']);
  }
}

const DRAFTABLE_EVENT_STATES: Partial<Record<ContentCategory, readonly EventState[]>> = {
  setlist_flash: ['setlist_confirmed', 'digest_ready', 'archived'],
  live_digest: ['digest_ready'],
  member_focus: ['digest_ready'],
  song_focus: ['digest_ready'],
};

export function assertDraftableEventState(content: ContentItem, event: EventRecord): void {
  const allowed = DRAFTABLE_EVENT_STATES[content.category];
  if (!allowed || !allowed.includes(event.state)) {
    throw new ContentPolicyError(
      'event_state_mismatch',
      `Category ${content.category} cannot be drafted while event ${event.event_id} is ${event.state}`,
      ['event_unknown'],
    );
  }
}

export function validateIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ContentPolicyError('invalid_datetime', `${field} must be an ISO 8601 datetime`, ['incorrect_metadata']);
  }
}

export function buildTrackedUrl(input: {
  baseUrl: string;
  campaignId: string;
  category: ContentCategory;
  templateId: string;
  variant: 'a' | 'b' | 'c';
}): string {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new ContentPolicyError('invalid_destination_url', 'Destination must be an absolute URL', ['link_invalid']);
  }
  if (url.protocol !== 'https:') {
    throw new ContentPolicyError('invalid_destination_url', 'Destination must use HTTPS', ['link_invalid']);
  }
  url.searchParams.set('utm_source', 'x');
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', input.campaignId);
  url.searchParams.set('utm_content', `${input.category}_${input.templateId}_${input.variant}`);
  return url.toString();
}

export function validatePostText(text: string, maxHashtags = PHASE1_POLICY.content.maxHashtags): { characterCount: number; weightedLength: number; hashtags: string[] } {
  const characterCount = Array.from(text).length;
  const parsed = twitterText.parseTweet(text);
  if (characterCount === 0 || !parsed.valid) {
    throw new ContentPolicyError('invalid_post_length', `Post text exceeds X weighted-text limits; weighted length ${parsed.weightedLength}`, ['incorrect_metadata']);
  }
  const hashtags = Array.from(text.matchAll(/(^|\s)#([^\s#]+)/gu), (match) => match[2]);
  if (hashtags.length > maxHashtags) {
    throw new ContentPolicyError('too_many_hashtags', `Post has ${hashtags.length} hashtags; maximum is ${maxHashtags}`, ['tone_inappropriate']);
  }
  const prohibited = PROHIBITED_PHRASES.find((phrase) => text.includes(phrase));
  if (prohibited) {
    throw new ContentPolicyError('prohibited_phrase', `Post contains a prohibited phrase: ${prohibited}`, ['tone_inappropriate']);
  }
  const exclamations = Array.from(text).filter((char) => char === '!' || char === '！').length;
  if (exclamations > 2) {
    throw new ContentPolicyError('too_many_exclamations', 'Post contains more than two exclamation marks', ['tone_inappropriate']);
  }
  const emojiCount = Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text))
    .filter(({ segment }) => (
      /\p{Extended_Pictographic}/u.test(segment)
      || /\p{Regional_Indicator}/u.test(segment)
      || /[#*0-9]\uFE0F?\u20E3/u.test(segment)
    )).length;
  if (emojiCount > 2) {
    throw new ContentPolicyError('too_many_emoji', 'Post contains more than two emoji graphemes', ['tone_inappropriate']);
  }
  return { characterCount, weightedLength: parsed.weightedLength, hashtags };
}

export function normalizeForSimilarity(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

export function textSimilarity(left: string, right: string): number {
  const a = bigrams(normalizeForSimilarity(left));
  const b = bigrams(normalizeForSimilarity(right));
  if (a.length === 0 && b.length === 0) return 1;
  const remaining = new Map<string, number>();
  for (const token of b) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let intersection = 0;
  for (const token of a) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(token, count - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

export function isDuplicateText(candidate: string, recentTexts: string[], threshold = PHASE1_POLICY.content.duplicateSimilarityThreshold): boolean {
  return recentTexts.some((text) => textSimilarity(candidate, text) >= threshold);
}

export function evaluateRights(event: EventRecord, media: MediaAsset): { passed: boolean; rejectReasons: RejectReason[]; reviewFlags: string[] } {
  const rejectReasons: RejectReason[] = [];
  const reviewFlags: string[] = [];
  const evidencePresent = Boolean(
    event.filming_policy.evidence_type
    && event.filming_policy.evidence_url
    && event.filming_policy.confirmed_at
    && event.filming_policy.confirmed_by === 'human_operator',
  );

  if (!event.filming_policy.confirmed || !media.rights.filming_policy_confirmed || !media.rights.publishing_allowed || !evidencePresent) {
    rejectReasons.push('rights_unconfirmed');
  }
  if (event.filming_policy.scope === 'unknown' || !media.rights.song_scope_confirmed) {
    rejectReasons.push('filming_scope_unknown');
  }
  if ((media.privacy.audience_visible || media.privacy.third_party_faces_detected) && !media.privacy.manual_review_completed) {
    rejectReasons.push('third_party_visible');
  }
  if (media.privacy.audience_visible || media.privacy.third_party_faces_detected) {
    reviewFlags.push('客席・第三者の映り込みを人間が確認済みであること');
  }
  if (!media.quality.video_ok || !media.quality.audio_ok || media.quality.score < 65) {
    rejectReasons.push('quality_low');
  }
  if (!media.quality.sync_ok) rejectReasons.push('audio_sync_issue');

  return { passed: rejectReasons.length === 0, rejectReasons: [...new Set(rejectReasons)], reviewFlags };
}

export function calculateQualityScore(breakdown: QualityBreakdown): number {
  let total = 0;
  for (const [axis, limit] of Object.entries(SCORE_LIMITS) as Array<[keyof QualityBreakdown, number]>) {
    const value = breakdown[axis];
    if (!Number.isFinite(value) || value < 0 || value > limit) {
      throw new ContentPolicyError('invalid_quality_score', `${axis} must be between 0 and ${limit}`, ['incorrect_metadata']);
    }
    total += value;
  }
  return total;
}

export function calculateFreshnessScore(endedAt: string, now: string): number {
  validateIsoDate(endedAt, 'endedAt');
  validateIsoDate(now, 'now');
  const elapsedMinutes = Math.max(0, (Date.parse(now) - Date.parse(endedAt)) / 60_000);
  if (elapsedMinutes <= 30) return 100;
  if (elapsedMinutes <= 120) return 85;
  if (elapsedMinutes <= 360) return 70;
  if (elapsedMinutes <= 720) return 55;
  if (elapsedMinutes <= 1_440) return 40;
  if (elapsedMinutes <= 2_880) return 20;
  return 10;
}

export function assertMediaPath(path: string): void {
  if (!path.startsWith('/') || path.includes('..') || path.includes('\0')) {
    throw new ContentPolicyError('unsafe_media_path', 'Media path must be absolute and contain no traversal', ['incorrect_metadata']);
  }
}

export function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new ContentPolicyError('invalid_media_hash', 'sha256 must contain exactly 64 hexadecimal characters', ['incorrect_metadata']);
  }
}

export function assertDraftApprovalGates(
  draft: DraftCandidate,
  input: { humanApproved: boolean; emergencyStopped: boolean; allowReserved?: boolean },
): void {
  if (input.emergencyStopped) {
    throw new ContentPolicyError('emergency_stop_active', 'Emergency stop is active');
  }
  if (!input.humanApproved) {
    throw new ContentPolicyError('human_approval_required', 'Human approval proof is required');
  }
  if (draft.approval_status !== 'pending_review' && !(input.allowReserved && draft.approval_status === 'approved')) {
    throw new ContentPolicyError('invalid_approval_state', 'Only pending_review or reserved drafts may be approved');
  }
  if (draft.quality_score < PHASE1_POLICY.content.minimumQualityScore) {
    throw new ContentPolicyError('quality_low', `Draft quality score is below ${PHASE1_POLICY.content.minimumQualityScore}`, ['quality_low']);
  }
  validatePostText(draft.text);
}
