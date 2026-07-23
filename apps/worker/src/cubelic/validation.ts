import {
  ContentPolicyError,
  isContentCategory,
  isEventState,
  isFanStage,
  validateIsoDate,
  type ContentItem,
  type EventRecord,
  type GasSetlistV1,
  type MemberMasterV1,
  type MediaAsset,
  type QualityBreakdown,
  type SongMasterV1,
} from '@x-harness/content-os';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentPolicyError('invalid_request', `${label} must be an object`, ['incorrect_metadata']);
  }
  return value as Record<string, unknown>;
}

function assertKeys(input: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ContentPolicyError('invalid_request', `${label} contains unknown fields: ${unknown.join(', ')}`, ['incorrect_metadata']);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContentPolicyError('invalid_request', `${label} must be a non-empty string`, ['incorrect_metadata']);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ContentPolicyError('invalid_request', `${label} must be boolean`, ['incorrect_metadata']);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ContentPolicyError('invalid_request', `${label} must be numeric`, ['incorrect_metadata']);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ContentPolicyError('invalid_request', `${label} must be a string array`, ['incorrect_metadata']);
  }
  return value;
}

export function parseEvent(value: unknown): EventRecord {
  const input = object(value, 'event');
  assertKeys(input, 'event', ['event_id', 'title', 'venue', 'starts_at', 'ends_at', 'state', 'official_url', 'ticket_url', 'event_tags', 'filming_policy']);
  const filming = object(input.filming_policy, 'filming_policy');
  assertKeys(filming, 'filming_policy', ['confirmed', 'scope', 'evidence_type', 'evidence_url', 'confirmed_at', 'confirmed_by', 'notes']);
  const state = string(input.state, 'state');
  if (!isEventState(state)) throw new ContentPolicyError('invalid_request', 'Unknown event state', ['incorrect_metadata']);
  const startsAt = string(input.starts_at, 'starts_at');
  const endsAt = string(input.ends_at, 'ends_at');
  validateIsoDate(startsAt, 'starts_at');
  validateIsoDate(endsAt, 'ends_at');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ContentPolicyError('invalid_request', 'ends_at must be after starts_at', ['incorrect_metadata']);
  const confirmedAt = nullableString(filming.confirmed_at, 'filming_policy.confirmed_at');
  if (confirmedAt) validateIsoDate(confirmedAt, 'filming_policy.confirmed_at');
  const scope = string(filming.scope, 'filming_policy.scope') as EventRecord['filming_policy']['scope'];
  if (!['full_event', 'selected_songs', 'selected_time', 'other', 'unknown'].includes(scope)) {
    throw new ContentPolicyError('invalid_request', 'Unknown filming scope', ['incorrect_metadata']);
  }
  const evidenceType = nullableString(filming.evidence_type, 'filming_policy.evidence_type') as EventRecord['filming_policy']['evidence_type'];
  if (evidenceType && !['official_x', 'official_site', 'venue_notice', 'staff_confirmation'].includes(evidenceType)) {
    throw new ContentPolicyError('invalid_request', 'Unknown evidence type', ['incorrect_metadata']);
  }
  const confirmedBy = nullableString(filming.confirmed_by, 'filming_policy.confirmed_by');
  if (confirmedBy && confirmedBy !== 'human_operator') throw new ContentPolicyError('invalid_request', 'filming_policy.confirmed_by must be human_operator', ['rights_unconfirmed']);
  const filmingConfirmed = boolean(filming.confirmed, 'filming_policy.confirmed');
  const evidenceUrl = nullableString(filming.evidence_url, 'filming_policy.evidence_url');
  if (filmingConfirmed && (!evidenceType || !evidenceUrl || !confirmedAt || confirmedBy !== 'human_operator')) {
    throw new ContentPolicyError('rights_unconfirmed', 'Confirmed filming policy requires evidence type, URL, timestamp, and human_operator', ['rights_unconfirmed']);
  }

  return {
    event_id: string(input.event_id, 'event_id'),
    title: string(input.title, 'title'),
    venue: string(input.venue, 'venue'),
    starts_at: startsAt,
    ends_at: endsAt,
    state,
    official_url: nullableString(input.official_url, 'official_url'),
    ticket_url: nullableString(input.ticket_url, 'ticket_url'),
    event_tags: strings(input.event_tags ?? [], 'event_tags'),
    filming_policy: {
      confirmed: filmingConfirmed,
      scope,
      evidence_type: evidenceType,
      evidence_url: evidenceUrl,
      confirmed_at: confirmedAt,
      confirmed_by: confirmedBy as 'human_operator' | null,
      notes: nullableString(filming.notes, 'filming_policy.notes'),
    },
  };
}

export function parseContent(value: unknown, now = new Date().toISOString()): ContentItem {
  const input = object(value, 'content');
  assertKeys(input, 'content', ['content_id', 'event_id', 'category', 'target_stage', 'content_lifecycle', 'status', 'source_type', 'source_refs', 'member_ids', 'song_ids', 'emotion_tags', 'destination', 'created_at', 'updated_at']);
  const category = string(input.category, 'category');
  const targetStage = string(input.target_stage, 'target_stage');
  if (!isContentCategory(category)) throw new ContentPolicyError('invalid_request', 'Unknown content category', ['incorrect_metadata']);
  if (!isFanStage(targetStage)) throw new ContentPolicyError('invalid_request', 'Unknown target stage', ['incorrect_metadata']);
  const lifecycle = object(input.content_lifecycle, 'content_lifecycle');
  assertKeys(lifecycle, 'content_lifecycle', ['type', 'expires_at']);
  const lifecycleType = string(lifecycle.type, 'content_lifecycle.type') as ContentItem['content_lifecycle']['type'];
  if (!['news', 'evergreen', 'hybrid'].includes(lifecycleType)) throw new ContentPolicyError('invalid_request', 'Unknown lifecycle type', ['incorrect_metadata']);
  const destination = object(input.destination, 'destination');
  assertKeys(destination, 'destination', ['type', 'base_url', 'tracked_url']);
  const baseUrl = string(destination.base_url, 'destination.base_url');
  if (nullableString(destination.tracked_url, 'destination.tracked_url')) {
    throw new ContentPolicyError('tracked_url_forbidden', 'tracked_url is generated by url-builder and must be empty', ['link_invalid']);
  }
  const status = (nullableString(input.status, 'status') ?? 'ingested') as ContentItem['status'];
  if (!['ingested', 'validated', 'draft_generated', 'blocked', 'archived'].includes(status)) {
    throw new ContentPolicyError('invalid_request', 'Unknown content status', ['incorrect_metadata']);
  }
  const sourceType = string(input.source_type, 'source_type') as ContentItem['source_type'];
  if (!['setlist_json', 'media_asset', 'event', 'manual'].includes(sourceType)) {
    throw new ContentPolicyError('invalid_request', 'Unknown content source type', ['incorrect_metadata']);
  }
  const expiresAt = nullableString(lifecycle.expires_at, 'content_lifecycle.expires_at');
  if (expiresAt) validateIsoDate(expiresAt, 'content_lifecycle.expires_at');
  return {
    content_id: string(input.content_id, 'content_id'),
    event_id: nullableString(input.event_id, 'event_id'),
    category,
    target_stage: targetStage,
    content_lifecycle: { type: lifecycleType, expires_at: expiresAt },
    status,
    source_type: sourceType,
    source_refs: strings(input.source_refs ?? [], 'source_refs'),
    member_ids: strings(input.member_ids ?? [], 'member_ids'),
    song_ids: strings(input.song_ids ?? [], 'song_ids'),
    emotion_tags: strings(input.emotion_tags ?? [], 'emotion_tags'),
    destination: { type: string(destination.type, 'destination.type'), base_url: baseUrl, tracked_url: '' },
    created_at: nullableString(input.created_at, 'created_at') ?? now,
    updated_at: now,
  };
}

export function parseMedia(value: unknown): MediaAsset {
  const input = object(value, 'media');
  assertKeys(input, 'media', ['asset_id', 'event_id', 'path', 'sha256', 'duration_seconds', 'orientation', 'resolution', 'audio_present', 'rights', 'privacy', 'quality', 'status']);
  const rights = object(input.rights, 'rights');
  assertKeys(rights, 'rights', ['filming_policy_confirmed', 'publishing_allowed', 'evidence_url', 'song_scope_confirmed']);
  const privacy = object(input.privacy, 'privacy');
  assertKeys(privacy, 'privacy', ['audience_visible', 'third_party_faces_detected', 'manual_review_completed', 'cropping_required', 'blurring_required']);
  const quality = object(input.quality, 'quality');
  assertKeys(quality, 'quality', ['video_ok', 'audio_ok', 'sync_ok', 'score']);
  const orientation = string(input.orientation, 'orientation') as MediaAsset['orientation'];
  if (!['vertical', 'horizontal', 'square'].includes(orientation)) throw new ContentPolicyError('invalid_request', 'Unknown orientation', ['incorrect_metadata']);
  const score = number(quality.score, 'quality.score');
  if (score < 0 || score > 100) throw new ContentPolicyError('invalid_request', 'quality.score must be between 0 and 100', ['incorrect_metadata']);
  return {
    asset_id: string(input.asset_id, 'asset_id'),
    event_id: string(input.event_id, 'event_id'),
    path: string(input.path, 'path'),
    sha256: string(input.sha256, 'sha256'),
    duration_seconds: number(input.duration_seconds, 'duration_seconds'),
    orientation,
    resolution: string(input.resolution, 'resolution'),
    audio_present: boolean(input.audio_present, 'audio_present'),
    rights: {
      filming_policy_confirmed: boolean(rights.filming_policy_confirmed, 'rights.filming_policy_confirmed'),
      publishing_allowed: boolean(rights.publishing_allowed, 'rights.publishing_allowed'),
      evidence_url: string(rights.evidence_url, 'rights.evidence_url'),
      song_scope_confirmed: boolean(rights.song_scope_confirmed, 'rights.song_scope_confirmed'),
    },
    privacy: {
      audience_visible: boolean(privacy.audience_visible, 'privacy.audience_visible'),
      third_party_faces_detected: boolean(privacy.third_party_faces_detected, 'privacy.third_party_faces_detected'),
      manual_review_completed: boolean(privacy.manual_review_completed, 'privacy.manual_review_completed'),
      cropping_required: boolean(privacy.cropping_required, 'privacy.cropping_required'),
      blurring_required: boolean(privacy.blurring_required, 'privacy.blurring_required'),
    },
    quality: {
      video_ok: boolean(quality.video_ok, 'quality.video_ok'),
      audio_ok: boolean(quality.audio_ok, 'quality.audio_ok'),
      sync_ok: boolean(quality.sync_ok, 'quality.sync_ok'),
      score,
    },
    status: 'pending_validation',
  };
}

export function parseSetlist(value: unknown): GasSetlistV1 {
  const input = object(value, 'setlist');
  assertKeys(input, 'setlist', ['schema_version', 'event_id', 'event_title', 'venue', 'starts_at', 'ends_at', 'lp_url', 'confirmed_at', 'confirmed_by', 'songs']);
  if (input.schema_version !== 'cubelic.gas-setlist.v1') throw new ContentPolicyError('unsupported_setlist_contract', 'Unsupported GAS setlist schema version', ['incorrect_metadata']);
  if (!Array.isArray(input.songs)) throw new ContentPolicyError('invalid_setlist', 'songs must be an array', ['song_unknown']);
  const startsAt = string(input.starts_at, 'starts_at');
  const endsAt = string(input.ends_at, 'ends_at');
  const confirmedAt = string(input.confirmed_at, 'confirmed_at');
  validateIsoDate(startsAt, 'starts_at');
  validateIsoDate(endsAt, 'ends_at');
  validateIsoDate(confirmedAt, 'confirmed_at');
  return {
    schema_version: 'cubelic.gas-setlist.v1',
    event_id: string(input.event_id, 'event_id'),
    event_title: string(input.event_title, 'event_title'),
    venue: string(input.venue, 'venue'),
    starts_at: startsAt,
    ends_at: endsAt,
    lp_url: string(input.lp_url, 'lp_url'),
    confirmed_at: confirmedAt,
    confirmed_by: string(input.confirmed_by, 'confirmed_by'),
    songs: input.songs.map((song, index) => {
      const item = object(song, `songs[${index}]`);
      assertKeys(item, `songs[${index}]`, ['position', 'song_id', 'title']);
      return { position: number(item.position, 'position'), song_id: string(item.song_id, 'song_id'), title: string(item.title, 'title') };
    }),
  };
}

export function parseSongMaster(value: unknown): SongMasterV1 {
  const input = object(value, 'song_master');
  assertKeys(input, 'song_master', ['schema_version', 'generated_at', 'songs']);
  if (input.schema_version !== 'cubelic.song-master.v1') throw new ContentPolicyError('invalid_request', 'Unsupported song master version', ['incorrect_metadata']);
  const generatedAt = string(input.generated_at, 'generated_at');
  validateIsoDate(generatedAt, 'generated_at');
  if (!Array.isArray(input.songs) || input.songs.length === 0) throw new ContentPolicyError('invalid_request', 'songs must be a non-empty array', ['song_unknown']);
  const seen = new Set<string>();
  const songs = input.songs.map((value, index) => {
    const song = object(value, `songs[${index}]`);
    assertKeys(song, `songs[${index}]`, ['song_id', 'title', 'aliases', 'active']);
    const songId = string(song.song_id, 'song_id');
    if (seen.has(songId)) throw new ContentPolicyError('invalid_request', `Duplicate song_id: ${songId}`, ['incorrect_metadata']);
    seen.add(songId);
    return { song_id: songId, title: string(song.title, 'title'), aliases: strings(song.aliases, 'aliases'), active: boolean(song.active, 'active') };
  });
  return { schema_version: 'cubelic.song-master.v1', generated_at: generatedAt, songs };
}

export function parseMemberMaster(value: unknown): MemberMasterV1 {
  const input = object(value, 'member_master');
  assertKeys(input, 'member_master', ['schema_version', 'generated_at', 'members']);
  if (input.schema_version !== 'cubelic.member-master.v1') throw new ContentPolicyError('invalid_request', 'Unsupported member master version', ['incorrect_metadata']);
  const generatedAt = string(input.generated_at, 'generated_at');
  validateIsoDate(generatedAt, 'generated_at');
  if (!Array.isArray(input.members) || input.members.length === 0) throw new ContentPolicyError('invalid_request', 'members must be a non-empty array', ['member_unknown']);
  const seen = new Set<string>();
  const members = input.members.map((value, index) => {
    const member = object(value, `members[${index}]`);
    assertKeys(member, `members[${index}]`, ['member_id', 'display_name', 'aliases', 'active']);
    const memberId = string(member.member_id, 'member_id');
    if (seen.has(memberId)) throw new ContentPolicyError('invalid_request', `Duplicate member_id: ${memberId}`, ['incorrect_metadata']);
    seen.add(memberId);
    return { member_id: memberId, display_name: string(member.display_name, 'display_name'), aliases: strings(member.aliases, 'aliases'), active: boolean(member.active, 'active') };
  });
  return { schema_version: 'cubelic.member-master.v1', generated_at: generatedAt, members };
}

export function parseQuality(value: unknown): QualityBreakdown {
  const input = object(value, 'quality_breakdown');
  assertKeys(input, 'quality_breakdown', ['accuracy', 'freshness', 'rarity', 'newcomer_clarity', 'appeal', 'route_clarity', 'conversation_shareability']);
  return {
    accuracy: number(input.accuracy, 'accuracy'),
    freshness: number(input.freshness, 'freshness'),
    rarity: number(input.rarity, 'rarity'),
    newcomer_clarity: number(input.newcomer_clarity, 'newcomer_clarity'),
    appeal: number(input.appeal, 'appeal'),
    route_clarity: number(input.route_clarity, 'route_clarity'),
    conversation_shareability: number(input.conversation_shareability, 'conversation_shareability'),
  };
}
