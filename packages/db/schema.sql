-- X Harness OSS — D1 Schema
-- Mirrors LINE Harness architecture for The Harness unification

-- X Accounts (1 deploy = 1 primary, but supports multi)
CREATE TABLE IF NOT EXISTS x_accounts (
  id TEXT PRIMARY KEY,
  x_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  consumer_key TEXT,
  consumer_secret TEXT,
  access_token_secret TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Engagement Gates (secret reply — killer feature)
CREATE TABLE IF NOT EXISTS engagement_gates (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('like', 'repost', 'reply', 'follow', 'quote')),
  action_type TEXT NOT NULL CHECK (action_type IN ('mention_post', 'dm', 'verify_only')),
  template TEXT NOT NULL,
  link TEXT,
  is_active INTEGER DEFAULT 1,
  line_harness_url TEXT,
  line_harness_api_key TEXT,
  line_harness_tag TEXT,
  line_harness_scenario_id TEXT,
  lottery_enabled INTEGER DEFAULT 0,
  lottery_rate INTEGER DEFAULT 100,
  lottery_win_template TEXT,
  lottery_lose_template TEXT,
  polling_strategy TEXT DEFAULT 'hot_window' CHECK (polling_strategy IN ('hot_window', 'constant', 'manual')),
  expires_at TEXT,
  next_poll_at TEXT,
  api_calls_total INTEGER DEFAULT 0,
  require_like INTEGER DEFAULT 0,
  require_repost INTEGER DEFAULT 0,
  require_follow INTEGER DEFAULT 0,
  last_reply_since_id TEXT,
  reply_keyword TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engagement_gates_active ON engagement_gates(is_active);
CREATE INDEX IF NOT EXISTS idx_engagement_gates_next_poll ON engagement_gates(next_poll_at, is_active);

-- Engagement Gate Deliveries (dedup tracking)
CREATE TABLE IF NOT EXISTS engagement_gate_deliveries (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT,
  delivered_post_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('delivered', 'failed', 'pending')),
  token TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(gate_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_gate_id ON engagement_gate_deliveries(gate_id);

-- Followers
CREATE TABLE IF NOT EXISTS followers (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  profile_image_url TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  is_following INTEGER DEFAULT 1,
  is_followed INTEGER DEFAULT 0,
  user_id TEXT,
  metadata TEXT DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  unfollowed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(x_account_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_followers_x_user_id ON followers(x_user_id);
CREATE INDEX IF NOT EXISTS idx_followers_user_id ON followers(user_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TEXT NOT NULL,
  UNIQUE(x_account_id, name)
);

-- Follower <-> Tag
CREATE TABLE IF NOT EXISTS follower_tags (
  follower_id TEXT NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_follower_tags_tag_id ON follower_tags(tag_id);

-- Scheduled Posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  media_ids TEXT,
  quote_tweet_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posted', 'failed')),
  posted_tweet_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_token ON engagement_gate_deliveries(token);

-- Users (UUID — The Harness unification)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step Sequences
CREATE TABLE IF NOT EXISTS step_sequences (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_messages (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES step_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_minutes INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('mention_post', 'dm')),
  template TEXT NOT NULL,
  link TEXT,
  condition_tag TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_messages_sequence ON step_messages(sequence_id, step_order);

CREATE TABLE IF NOT EXISTS step_enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES step_sequences(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT,
  current_step INTEGER DEFAULT 0,
  next_run_at TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sequence_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_step_enrollments_next_run ON step_enrollments(next_run_at, status);

-- Follower Snapshots (daily tracking)
CREATE TABLE IF NOT EXISTS follower_snapshots (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  followers_count INTEGER NOT NULL,
  following_count INTEGER NOT NULL,
  tweet_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (x_account_id) REFERENCES x_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_follower_snapshots_account_date ON follower_snapshots(x_account_id, recorded_at);

-- Quote Tweets (persisted — X API only keeps 7 days)
CREATE TABLE IF NOT EXISTS quote_tweets (
  id TEXT PRIMARY KEY,
  source_tweet_id TEXT NOT NULL,
  x_account_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_username TEXT,
  author_display_name TEXT,
  author_profile_image_url TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  FOREIGN KEY (x_account_id) REFERENCES x_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_quote_tweets_source ON quote_tweets(source_tweet_id);
CREATE INDEX IF NOT EXISTS idx_quote_tweets_account ON quote_tweets(x_account_id, discovered_at DESC);

-- Engagement Actions (persist like/repost/reply from dashboard)
CREATE TABLE IF NOT EXISTS engagement_actions (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('like', 'repost', 'reply')),
  created_at TEXT NOT NULL,
  UNIQUE(x_account_id, tweet_id, action_type)
);
CREATE INDEX IF NOT EXISTS idx_engagement_actions_account ON engagement_actions(x_account_id);

-- Growth Drafts (planner output awaiting dashboard approval)
CREATE TABLE IF NOT EXISTS growth_drafts (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  quote_tweet_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'rejected')),
  scheduled_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_status ON growth_drafts(status);

-- Growth Digests (daily news/strategy summary from collector)
CREATE TABLE IF NOT EXISTS growth_digests (
  date TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Source Candidates (overseas viral tweet candidates for quote-tweet)
CREATE TABLE IF NOT EXISTS source_candidates (
  id TEXT PRIMARY KEY,
  source_tweet_id TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL,
  author_url TEXT,
  text_en TEXT NOT NULL,
  text_ja TEXT NOT NULL,
  summary_ja TEXT,
  suggested_quote_text TEXT,
  video_url TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  theme TEXT,
  transcript TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'dismissed')),
  discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_candidates_status ON source_candidates(status);

-- Growth Articles (AI-generated article drafts awaiting publish)
CREATE TABLE IF NOT EXISTS growth_articles (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  image_url TEXT,
  theme TEXT,
  source_tweet_ids TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  published_article_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_articles_status ON growth_articles(status);

-- CUBΣLIC Content OS Phase 1

CREATE TABLE IF NOT EXISTS cubelic_events (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','announced','ticket_open','upcoming','event_day','in_progress','ended','setlist_confirmed','digest_ready','archived')),
  official_url TEXT,
  ticket_url TEXT,
  event_tags TEXT NOT NULL DEFAULT '[]',
  filming_policy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_events_starts_at ON cubelic_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_cubelic_events_state ON cubelic_events(state);

CREATE TABLE IF NOT EXISTS cubelic_rights_evidence (
  evidence_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cubelic_events(event_id),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('official_x','official_site','venue_notice','staff_confirmation')),
  evidence_url TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('full_event','selected_songs','selected_time','other')),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_rights_event ON cubelic_rights_evidence(event_id);

CREATE TABLE IF NOT EXISTS cubelic_songs (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  source_generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_members (
  member_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  source_generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_media_assets (
  asset_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cubelic_events(event_id),
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  duration_seconds REAL NOT NULL,
  orientation TEXT NOT NULL CHECK (orientation IN ('vertical','horizontal','square')),
  resolution TEXT NOT NULL,
  audio_present INTEGER NOT NULL CHECK (audio_present IN (0,1)),
  rights TEXT NOT NULL,
  privacy TEXT NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_validation','blocked','approved_for_draft')),
  reject_reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_media_event ON cubelic_media_assets(event_id);

CREATE TABLE IF NOT EXISTS cubelic_setlists (
  setlist_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES cubelic_events(event_id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'cubelic.gas-setlist.v1'),
  payload TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL UNIQUE,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_setlists_event ON cubelic_setlists(event_id);

CREATE TABLE IF NOT EXISTS cubelic_content_items (
  content_id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES cubelic_events(event_id),
  category TEXT NOT NULL,
  target_stage TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ingested','validated','draft_generated','blocked','archived')),
  source_type TEXT NOT NULL CHECK (source_type IN ('setlist_json','media_asset','event','manual')),
  source_refs TEXT NOT NULL DEFAULT '[]',
  member_ids TEXT NOT NULL DEFAULT '[]',
  song_ids TEXT NOT NULL DEFAULT '[]',
  emotion_tags TEXT NOT NULL DEFAULT '[]',
  destination TEXT NOT NULL,
  reject_reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_content_event ON cubelic_content_items(event_id);
CREATE INDEX IF NOT EXISTS idx_cubelic_content_status ON cubelic_content_items(status);

CREATE TABLE IF NOT EXISTS cubelic_draft_posts (
  draft_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES cubelic_content_items(content_id),
  account_id TEXT NOT NULL CHECK (account_id = 'tubelic_cube'),
  text TEXT NOT NULL,
  media_asset_ids TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('a','b','c')),
  target_stage TEXT NOT NULL,
  emotion_tags TEXT NOT NULL DEFAULT '[]',
  hashtags TEXT NOT NULL DEFAULT '[]',
  destination_url TEXT NOT NULL,
  utm TEXT NOT NULL,
  quality_score REAL NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
  quality_breakdown TEXT NOT NULL,
  freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
  rights_gate TEXT NOT NULL CHECK (rights_gate IN ('passed','not_applicable')),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending_review','needs_revision','rejected','approved','handed_off')),
  risks TEXT NOT NULL DEFAULT '[]',
  human_review_required TEXT NOT NULL DEFAULT '[]',
  reject_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  approved_by TEXT,
  approved_at TEXT,
  x_harness_inbox_id TEXT,
  scheduled_at TEXT CHECK (scheduled_at IS NULL),
  published_post_id TEXT CHECK (published_post_id IS NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_drafts_status ON cubelic_draft_posts(approval_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cubelic_content_variant ON cubelic_draft_posts(content_id, template_version, variant);

CREATE TABLE IF NOT EXISTS cubelic_x_draft_inbox (
  inbox_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES cubelic_draft_posts(draft_id),
  x_account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  media_asset_ids TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'inert_draft' CHECK (status = 'inert_draft'),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_post_mappings (
  post_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES cubelic_draft_posts(draft_id),
  published_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source = 'manual'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubelic_post_mappings_draft ON cubelic_post_mappings(draft_id);

CREATE TABLE IF NOT EXISTS cubelic_metrics (
  metric_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('2h','24h','72h','7d')),
  values_json TEXT NOT NULL,
  UNIQUE(post_id, window)
);

CREATE TABLE IF NOT EXISTS cubelic_incidents (
  incident_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','contained','resolved')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_rejection_events (
  rejection_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK (actor IN ('human','hermes','system','codex')),
  reason TEXT NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(correlation_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_cubelic_rejections_reason_time ON cubelic_rejection_events(reason, occurred_at DESC);

CREATE TABLE IF NOT EXISTS cubelic_audit_logs (
  audit_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK (actor IN ('human','hermes','system','codex')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  correlation_id TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS cubelic_stop_events_insert BEFORE INSERT ON cubelic_events
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_events_update BEFORE UPDATE ON cubelic_events
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_songs_insert BEFORE INSERT ON cubelic_songs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_songs_update BEFORE UPDATE ON cubelic_songs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_members_insert BEFORE INSERT ON cubelic_members
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_members_update BEFORE UPDATE ON cubelic_members
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_content_insert BEFORE INSERT ON cubelic_content_items
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_content_update BEFORE UPDATE ON cubelic_content_items
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_media_insert BEFORE INSERT ON cubelic_media_assets
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_media_update BEFORE UPDATE ON cubelic_media_assets
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_setlists_insert BEFORE INSERT ON cubelic_setlists
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_drafts_insert BEFORE INSERT ON cubelic_draft_posts
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_drafts_update BEFORE UPDATE ON cubelic_draft_posts
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_draft_state_transition BEFORE UPDATE OF approval_status ON cubelic_draft_posts
WHEN NOT (
  (OLD.approval_status IN ('pending_review', 'needs_revision') AND NEW.approval_status = 'rejected') OR
  (OLD.approval_status = 'pending_review' AND NEW.approval_status = 'approved') OR
  (OLD.approval_status = 'approved' AND NEW.approval_status = 'handed_off')
)
BEGIN SELECT RAISE(ABORT, 'invalid cubelic draft state transition'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_draft_approval_gates BEFORE UPDATE OF approval_status ON cubelic_draft_posts
WHEN NEW.approval_status IN ('approved', 'handed_off') AND (
  NEW.quality_score < 80 OR
  (NEW.category = 'setlist_flash' AND NEW.rights_gate <> 'not_applicable') OR
  (NEW.category IN ('live_digest', 'member_focus', 'song_focus') AND NEW.rights_gate <> 'passed') OR
  NOT EXISTS (
    SELECT 1 FROM cubelic_content_items AS content
    JOIN cubelic_events AS event ON event.event_id = content.event_id
    WHERE content.content_id = NEW.content_id
      AND content.category = NEW.category
      AND content.status = 'draft_generated'
      AND (json_extract(content.lifecycle, '$.expires_at') IS NULL OR julianday(json_extract(content.lifecycle, '$.expires_at')) > julianday('now'))
      AND (
        (content.category = 'setlist_flash' AND event.state IN ('setlist_confirmed', 'digest_ready', 'archived')) OR
        (content.category IN ('live_digest', 'member_focus', 'song_focus') AND event.state = 'digest_ready')
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(content.song_ids) AS reference
        LEFT JOIN cubelic_songs AS song ON song.song_id = reference.value AND song.active = 1
        WHERE song.song_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(content.member_ids) AS reference
        LEFT JOIN cubelic_members AS member ON member.member_id = reference.value AND member.active = 1
        WHERE member.member_id IS NULL
      )
  ) OR
  (NEW.category IN ('live_digest', 'member_focus', 'song_focus') AND json_array_length(NEW.media_asset_ids) = 0) OR
  EXISTS (
    SELECT 1 FROM json_each(NEW.media_asset_ids) AS reference
    LEFT JOIN cubelic_media_assets AS media ON media.asset_id = reference.value
    LEFT JOIN cubelic_events AS event ON event.event_id = media.event_id
    LEFT JOIN cubelic_content_items AS content ON content.content_id = NEW.content_id
    WHERE media.asset_id IS NULL
      OR media.event_id <> content.event_id
      OR media.status <> 'approved_for_draft'
      OR COALESCE(json_extract(event.filming_policy, '$.confirmed'), 0) <> 1
      OR COALESCE(json_extract(event.filming_policy, '$.scope'), 'unknown') = 'unknown'
      OR json_extract(event.filming_policy, '$.evidence_type') IS NULL
      OR json_extract(event.filming_policy, '$.evidence_url') IS NULL
      OR json_extract(event.filming_policy, '$.confirmed_at') IS NULL
      OR COALESCE(json_extract(event.filming_policy, '$.confirmed_by'), '') <> 'human_operator'
      OR COALESCE(json_extract(media.rights, '$.filming_policy_confirmed'), 0) <> 1
      OR COALESCE(json_extract(media.rights, '$.song_scope_confirmed'), 0) <> 1
      OR COALESCE(json_extract(media.rights, '$.publishing_allowed'), 0) <> 1
      OR COALESCE(json_extract(media.rights, '$.evidence_url'), '') = ''
      OR ((json_extract(media.privacy, '$.audience_visible') = 1 OR json_extract(media.privacy, '$.third_party_faces_detected') = 1)
          AND COALESCE(json_extract(media.privacy, '$.manual_review_completed'), 0) <> 1)
      OR COALESCE(json_extract(media.quality, '$.video_ok'), 0) <> 1
      OR COALESCE(json_extract(media.quality, '$.audio_ok'), 0) <> 1
      OR COALESCE(json_extract(media.quality, '$.sync_ok'), 0) <> 1
      OR COALESCE(json_extract(media.quality, '$.score'), -1) < 65
  )
)
BEGIN SELECT RAISE(ABORT, 'cubelic draft approval gates failed'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_handoff_requires_matching_inbox BEFORE UPDATE OF approval_status ON cubelic_draft_posts
WHEN NEW.approval_status = 'handed_off' AND (
  NEW.x_harness_inbox_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM cubelic_x_draft_inbox AS inbox
    WHERE inbox.inbox_id = NEW.x_harness_inbox_id
      AND inbox.draft_id = NEW.draft_id
      AND inbox.text = NEW.text
      AND inbox.media_asset_ids = NEW.media_asset_ids
      AND inbox.idempotency_key = NEW.idempotency_key
  )
)
BEGIN SELECT RAISE(ABORT, 'cubelic handoff requires a matching inert inbox'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_draft_text_edit_state BEFORE UPDATE OF text ON cubelic_draft_posts
WHEN OLD.approval_status NOT IN ('pending_review', 'needs_revision')
BEGIN SELECT RAISE(ABORT, 'cubelic draft text is immutable in this state'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_freeze_content_during_approval BEFORE UPDATE ON cubelic_content_items
WHEN EXISTS (SELECT 1 FROM cubelic_draft_posts WHERE content_id = OLD.content_id AND approval_status = 'approved')
BEGIN SELECT RAISE(ABORT, 'cubelic content is frozen during approval'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_freeze_event_during_approval BEFORE UPDATE ON cubelic_events
WHEN EXISTS (
  SELECT 1 FROM cubelic_draft_posts AS draft
  JOIN cubelic_content_items AS content ON content.content_id = draft.content_id
  WHERE draft.approval_status = 'approved' AND content.event_id = OLD.event_id
)
BEGIN SELECT RAISE(ABORT, 'cubelic event is frozen during approval'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_freeze_media_during_approval BEFORE UPDATE ON cubelic_media_assets
WHEN EXISTS (
  SELECT 1 FROM cubelic_draft_posts AS draft, json_each(draft.media_asset_ids) AS reference
  WHERE draft.approval_status = 'approved' AND reference.value = OLD.asset_id
)
BEGIN SELECT RAISE(ABORT, 'cubelic media is frozen during approval'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_freeze_song_during_approval BEFORE UPDATE ON cubelic_songs
WHEN EXISTS (
  SELECT 1 FROM cubelic_draft_posts AS draft
  JOIN cubelic_content_items AS content ON content.content_id = draft.content_id
  JOIN json_each(content.song_ids) AS reference ON reference.value = OLD.song_id
  WHERE draft.approval_status = 'approved'
)
BEGIN SELECT RAISE(ABORT, 'cubelic song is frozen during approval'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_freeze_member_during_approval BEFORE UPDATE ON cubelic_members
WHEN EXISTS (
  SELECT 1 FROM cubelic_draft_posts AS draft
  JOIN cubelic_content_items AS content ON content.content_id = draft.content_id
  JOIN json_each(content.member_ids) AS reference ON reference.value = OLD.member_id
  WHERE draft.approval_status = 'approved'
)
BEGIN SELECT RAISE(ABORT, 'cubelic member is frozen during approval'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_inbox_insert BEFORE INSERT ON cubelic_x_draft_inbox
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_inbox_requires_approved_draft BEFORE INSERT ON cubelic_x_draft_inbox
WHEN NOT EXISTS (
  SELECT 1 FROM cubelic_draft_posts AS draft
  WHERE draft.draft_id = NEW.draft_id
    AND draft.approval_status = 'approved'
    AND draft.text = NEW.text
    AND draft.media_asset_ids = NEW.media_asset_ids
    AND draft.idempotency_key = NEW.idempotency_key
)
BEGIN SELECT RAISE(ABORT, 'inert inbox requires the matching approved cubelic draft'); END;
CREATE TRIGGER IF NOT EXISTS cubelic_stop_post_mapping_insert BEFORE INSERT ON cubelic_post_mappings
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN SELECT RAISE(ABORT, 'cubelic emergency stop active'); END;
CREATE INDEX IF NOT EXISTS idx_cubelic_audit_entity ON cubelic_audit_logs(entity_type, entity_id, timestamp);

CREATE TRIGGER IF NOT EXISTS cubelic_audit_no_update
BEFORE UPDATE ON cubelic_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'cubelic_audit_logs are append-only');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_audit_no_delete
BEFORE DELETE ON cubelic_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'cubelic_audit_logs are append-only');
END;

INSERT OR IGNORE INTO cubelic_system_flags (key, value, updated_at, updated_by)
VALUES ('emergency_stop', 'true', '2026-07-21T00:00:00.000Z', 'system');
