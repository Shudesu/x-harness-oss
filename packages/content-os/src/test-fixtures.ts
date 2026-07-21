import type { ContentItem, EventRecord, GasSetlistV1, MediaAsset, QualityBreakdown } from './types.js';

export const eventFixture: EventRecord = {
  event_id: 'evt_20260721_example',
  title: 'CUBΣLIC LIVE',
  venue: 'SHIBUYA DESEO',
  starts_at: '2026-07-21T19:00:00+09:00',
  ends_at: '2026-07-21T20:30:00+09:00',
  state: 'setlist_confirmed',
  official_url: 'https://x.com/CUBELIC_hvt',
  ticket_url: null,
  event_tags: [],
  filming_policy: {
    confirmed: true,
    scope: 'full_event',
    evidence_type: 'official_x',
    evidence_url: 'https://x.com/CUBELIC_hvt/status/123',
    confirmed_at: '2026-07-21T18:00:00+09:00',
    confirmed_by: 'human_operator',
    notes: null,
  },
};

export const setlistFixture: GasSetlistV1 = {
  schema_version: 'cubelic.gas-setlist.v1',
  event_id: eventFixture.event_id,
  event_title: eventFixture.title,
  venue: eventFixture.venue,
  starts_at: eventFixture.starts_at,
  ends_at: eventFixture.ends_at,
  lp_url: 'https://cubelic-fan.com/setlists/evt_20260721_example',
  confirmed_at: '2026-07-21T20:40:00+09:00',
  confirmed_by: 'operator',
  songs: [
    { position: 1, song_id: 'song_1', title: '微レ存ガール' },
    { position: 2, song_id: 'song_2', title: 'いえないっしょん' },
    { position: 3, song_id: 'song_3', title: 'グリッチ&&グリッチ' },
  ],
};

export const contentFixture: ContentItem = {
  content_id: 'cnt_20260721_001',
  event_id: eventFixture.event_id,
  category: 'setlist_flash',
  target_stage: 'interested',
  content_lifecycle: { type: 'hybrid', expires_at: null },
  status: 'validated',
  source_type: 'setlist_json',
  source_refs: ['setlist_1'],
  member_ids: [],
  song_ids: setlistFixture.songs.map((song) => song.song_id),
  emotion_tags: ['informative'],
  destination: {
    type: 'setlist_page',
    base_url: setlistFixture.lp_url,
    tracked_url: '',
  },
  created_at: '2026-07-21T20:41:00+09:00',
  updated_at: '2026-07-21T20:41:00+09:00',
};

export const mediaFixture: MediaAsset = {
  asset_id: 'ast_20260721_001',
  event_id: eventFixture.event_id,
  path: '/exports/20260721/clip01.mp4',
  sha256: 'a'.repeat(64),
  duration_seconds: 24.8,
  orientation: 'vertical',
  resolution: '1080x1920',
  audio_present: true,
  rights: {
    filming_policy_confirmed: true,
    publishing_allowed: true,
    evidence_url: 'https://x.com/CUBELIC_hvt/status/123',
    song_scope_confirmed: true,
  },
  privacy: {
    audience_visible: false,
    third_party_faces_detected: false,
    manual_review_completed: true,
    cropping_required: false,
    blurring_required: false,
  },
  quality: {
    video_ok: true,
    audio_ok: true,
    sync_ok: true,
    score: 86,
  },
  status: 'approved_for_draft',
};

export const passingQuality: QualityBreakdown = {
  accuracy: 20,
  freshness: 13,
  rarity: 12,
  newcomer_clarity: 13,
  appeal: 12,
  route_clarity: 8,
  conversation_shareability: 7,
};
