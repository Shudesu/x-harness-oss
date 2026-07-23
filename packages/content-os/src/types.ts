export const EVENT_STATES = [
  'draft',
  'announced',
  'ticket_open',
  'upcoming',
  'event_day',
  'in_progress',
  'ended',
  'setlist_confirmed',
  'digest_ready',
  'archived',
] as const;
export type EventState = (typeof EVENT_STATES)[number];

export const FAN_STAGES = [
  'unaware',
  'aware',
  'interested',
  'first_visit_intent',
  'first_visitor',
  'repeat_fan',
  'advocate',
] as const;
export type FanStage = (typeof FAN_STAGES)[number];

export const CONTENT_CATEGORIES = [
  'live_digest',
  'member_focus',
  'song_focus',
  'setlist_flash',
  'setlist_archive',
  'beginner_guide',
  'event_notice',
  'event_reminder',
  'member_profile',
  'youtube_notice',
  'playlist_notice',
  'community_question',
  'weekly_summary',
  'evergreen',
  'correction',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const REJECT_REASONS = [
  'rights_unconfirmed',
  'filming_scope_unknown',
  'third_party_visible',
  'member_unknown',
  'event_unknown',
  'song_unknown',
  'duplicate_content',
  'duplicate_media',
  'quality_low',
  'audio_sync_issue',
  'incorrect_metadata',
  'link_invalid',
  'expired_content',
  'tone_inappropriate',
  'official_confusion_risk',
  'manual_rejection',
  'other',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const APPROVAL_STATUSES = [
  'pending_review',
  'needs_revision',
  'rejected',
  'approved',
  'handed_off',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface FilmingPolicy {
  confirmed: boolean;
  scope: 'full_event' | 'selected_songs' | 'selected_time' | 'other' | 'unknown';
  evidence_type: 'official_x' | 'official_site' | 'venue_notice' | 'staff_confirmation' | null;
  evidence_url: string | null;
  confirmed_at: string | null;
  confirmed_by: 'human_operator' | null;
  notes?: string | null;
}

export interface EventRecord {
  event_id: string;
  title: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  state: EventState;
  official_url?: string | null;
  ticket_url?: string | null;
  event_tags: string[];
  filming_policy: FilmingPolicy;
}

export interface MediaAsset {
  asset_id: string;
  event_id: string;
  path: string;
  sha256: string;
  duration_seconds: number;
  orientation: 'vertical' | 'horizontal' | 'square';
  resolution: string;
  audio_present: boolean;
  rights: {
    filming_policy_confirmed: boolean;
    publishing_allowed: boolean;
    evidence_url: string;
    song_scope_confirmed: boolean;
  };
  privacy: {
    audience_visible: boolean;
    third_party_faces_detected: boolean;
    manual_review_completed: boolean;
    cropping_required: boolean;
    blurring_required: boolean;
  };
  quality: {
    video_ok: boolean;
    audio_ok: boolean;
    sync_ok: boolean;
    score: number;
  };
  status: 'pending_validation' | 'blocked' | 'approved_for_draft';
}

export interface ContentItem {
  content_id: string;
  event_id: string | null;
  category: ContentCategory;
  target_stage: FanStage;
  content_lifecycle: {
    type: 'news' | 'evergreen' | 'hybrid';
    expires_at: string | null;
  };
  status: 'ingested' | 'validated' | 'draft_generated' | 'blocked' | 'archived';
  source_type: 'setlist_json' | 'media_asset' | 'event' | 'manual';
  source_refs: string[];
  member_ids: string[];
  song_ids: string[];
  emotion_tags: string[];
  destination: {
    type: string;
    base_url: string;
    tracked_url: string;
  };
  created_at: string;
  updated_at: string;
}

export interface QualityBreakdown {
  accuracy: number;
  freshness: number;
  rarity: number;
  newcomer_clarity: number;
  appeal: number;
  route_clarity: number;
  conversation_shareability: number;
}

export interface DraftCandidate {
  draft_id: string;
  content_id: string;
  account_id: string;
  text: string;
  media_asset_ids: string[];
  category: ContentCategory;
  template_id: string;
  template_version: string;
  variant: 'a' | 'b' | 'c';
  target_stage: FanStage;
  emotion_tags: string[];
  hashtags: string[];
  destination_url: string;
  utm: {
    source: 'x';
    medium: 'social';
    campaign: string;
    content: string;
  };
  quality_score: number;
  quality_breakdown: QualityBreakdown;
  freshness_score: number;
  rights_gate: 'passed' | 'not_applicable';
  approval_status: ApprovalStatus;
  risks: string[];
  human_review_required: string[];
  idempotency_key: string;
  scheduled_at: null;
  published_post_id: null;
  created_at: string;
  updated_at: string;
}

export interface GasSetlistV1 {
  schema_version: 'cubelic.gas-setlist.v1';
  event_id: string;
  event_title: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  lp_url: string;
  confirmed_at: string;
  confirmed_by: string;
  songs: Array<{
    position: number;
    song_id: string;
    title: string;
  }>;
}

export interface SongMasterV1 {
  schema_version: 'cubelic.song-master.v1';
  generated_at: string;
  songs: Array<{
    song_id: string;
    title: string;
    aliases: string[];
    active: boolean;
  }>;
}

export interface MemberMasterV1 {
  schema_version: 'cubelic.member-master.v1';
  generated_at: string;
  members: Array<{
    member_id: string;
    display_name: string;
    aliases: string[];
    active: boolean;
  }>;
}

export interface XDraftInput {
  draftId: string;
  accountId: string;
  text: string;
  mediaAssetIds: string[];
  idempotencyKey: string;
  approvedBy: string;
  approvedAt: string;
}

export interface XDraftResult {
  inboxId: string;
  status: 'inert_draft';
  idempotentReplay: boolean;
}

export interface XHarnessInertDraftV1 {
  schema_version: 'cubelic.x-harness-inert-draft.v1';
  inbox_id: string;
  draft_id: string;
  x_account_id: string;
  text: string;
  media_asset_ids: string[];
  idempotency_key: string;
  status: 'inert_draft';
  approved_by: string;
  approved_at: string;
  created_at: string;
}

export interface PostMetrics {
  impressions: number | null;
  video_views: number | null;
  video_completion_rate: number | null;
  likes: number | null;
  reposts: number | null;
  quotes: number | null;
  replies: number | null;
  profile_visits: number | null;
  follows_attributed: number | null;
  link_clicks: number | null;
  qualified_visits: number | null;
  youtube_clicks: number | null;
  spotify_clicks: number | null;
  ticket_clicks: number | null;
}

export interface XPublishingAdapter {
  createDraft(input: XDraftInput): Promise<XDraftResult>;
  schedulePost(): Promise<never>;
  publishPost(): Promise<never>;
  deletePost(): Promise<never>;
  getMetrics(postId: string): Promise<PostMetrics>;
}
