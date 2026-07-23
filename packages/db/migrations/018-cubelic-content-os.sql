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
