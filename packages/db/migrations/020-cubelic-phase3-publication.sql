-- CUBΣLIC Phase 3 publication substrate.
-- Capability remains disabled unless the Worker has CUBELIC_PHASE3_ENABLED=true.

CREATE TABLE IF NOT EXISTS cubelic_manual_authorities (
  authority_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES cubelic_content_items(content_id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'cubelic.manual-production-authority.v1'),
  attested_by TEXT NOT NULL,
  attested_at TEXT NOT NULL,
  rights_confirmed INTEGER NOT NULL CHECK (rights_confirmed = 1),
  privacy_review_completed INTEGER NOT NULL CHECK (privacy_review_completed = 1),
  destination_url TEXT NOT NULL,
  link_validated INTEGER NOT NULL CHECK (link_validated = 1),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubelic_publication_jobs (
  job_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES cubelic_draft_posts(draft_id),
  operation TEXT NOT NULL CHECK (operation IN ('schedule','publish')),
  status TEXT NOT NULL CHECK (status IN ('scheduled','publishing','published','failed','cancelled')),
  authorization_kind TEXT NOT NULL CHECK (authorization_kind IN ('human_individual','preapproved_template')),
  policy_id TEXT,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  scheduled_at TEXT,
  published_at TEXT,
  post_id TEXT UNIQUE,
  claim_token TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (operation = 'schedule' AND authorization_kind = 'preapproved_template' AND policy_id IS NOT NULL AND scheduled_at IS NOT NULL)
    OR
    (operation = 'publish' AND authorization_kind = 'human_individual' AND policy_id IS NULL AND scheduled_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_cubelic_publication_due
  ON cubelic_publication_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_cubelic_publication_draft
  ON cubelic_publication_jobs(draft_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS cubelic_publication_requires_approved_draft
BEFORE INSERT ON cubelic_publication_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM cubelic_draft_posts
  WHERE draft_id = NEW.draft_id
    AND approval_status IN ('approved','handed_off')
    AND approved_by = NEW.authorized_by
    AND approved_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'cubelic publication requires matching human-approved draft');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_publication_reserves_rate_slot
BEFORE INSERT ON cubelic_publication_jobs
WHEN
  EXISTS (
    SELECT 1 FROM cubelic_publication_jobs AS existing
    WHERE existing.status IN ('scheduled','publishing','published')
      AND ABS(
        (julianday(CASE existing.status
          WHEN 'published' THEN existing.published_at
          WHEN 'publishing' THEN existing.updated_at
          ELSE existing.scheduled_at
        END)
        - julianday(CASE NEW.status
          WHEN 'publishing' THEN NEW.created_at
          ELSE NEW.scheduled_at
        END)) * 1440
      ) < 240
  )
  OR (
    SELECT COUNT(*) FROM cubelic_publication_jobs AS existing
    WHERE existing.status IN ('scheduled','publishing','published')
      AND date(CASE existing.status
        WHEN 'published' THEN existing.published_at
        WHEN 'publishing' THEN existing.updated_at
        ELSE existing.scheduled_at
      END, '+9 hours')
        = date(CASE NEW.status
          WHEN 'publishing' THEN NEW.created_at
          ELSE NEW.scheduled_at
        END, '+9 hours')
  ) >= 2
  OR EXISTS (
    SELECT 1
    FROM (
      SELECT CASE existing.status
        WHEN 'published' THEN existing.published_at
        WHEN 'publishing' THEN existing.updated_at
        ELSE existing.scheduled_at
      END AS window_start
      FROM cubelic_publication_jobs AS existing
      WHERE existing.status IN ('scheduled','publishing','published')
        AND julianday(CASE existing.status
          WHEN 'published' THEN existing.published_at
          WHEN 'publishing' THEN existing.updated_at
          ELSE existing.scheduled_at
        END) > julianday(CASE NEW.status
          WHEN 'publishing' THEN NEW.created_at
          ELSE NEW.scheduled_at
        END, '-7 days')
        AND julianday(CASE existing.status
          WHEN 'published' THEN existing.published_at
          WHEN 'publishing' THEN existing.updated_at
          ELSE existing.scheduled_at
        END) <= julianday(CASE NEW.status
          WHEN 'publishing' THEN NEW.created_at
          ELSE NEW.scheduled_at
        END)
      UNION
      SELECT CASE NEW.status
        WHEN 'publishing' THEN NEW.created_at
        ELSE NEW.scheduled_at
      END
    ) AS candidate_starts
    WHERE (
      SELECT COUNT(*)
      FROM cubelic_publication_jobs AS counted
      WHERE counted.status IN ('scheduled','publishing','published')
        AND julianday(CASE counted.status
          WHEN 'published' THEN counted.published_at
          WHEN 'publishing' THEN counted.updated_at
          ELSE counted.scheduled_at
        END) >= julianday(candidate_starts.window_start)
        AND julianday(CASE counted.status
          WHEN 'published' THEN counted.published_at
          WHEN 'publishing' THEN counted.updated_at
          ELSE counted.scheduled_at
        END) < julianday(candidate_starts.window_start, '+7 days')
    ) >= 10
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic publication rate slot unavailable');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_stop_manual_authority_insert
BEFORE INSERT ON cubelic_manual_authorities
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_stop_publication_insert
BEFORE INSERT ON cubelic_publication_jobs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_stop_publication_update
BEFORE UPDATE ON cubelic_publication_jobs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;

DROP TRIGGER IF EXISTS cubelic_draft_approval_gates;
CREATE TRIGGER cubelic_draft_approval_gates BEFORE UPDATE OF approval_status ON cubelic_draft_posts
WHEN NEW.approval_status IN ('approved', 'handed_off') AND (
  NEW.quality_score < 80 OR
  (NEW.category = 'setlist_flash' AND NEW.rights_gate <> 'not_applicable') OR
  (NEW.category IN ('live_digest', 'member_focus', 'song_focus') AND NEW.rights_gate <> 'passed') OR
  NOT EXISTS (
    SELECT 1 FROM cubelic_content_items AS content
    LEFT JOIN cubelic_events AS event ON event.event_id = content.event_id
    WHERE content.content_id = NEW.content_id
      AND content.category = NEW.category
      AND content.status = 'draft_generated'
      AND (json_extract(content.lifecycle, '$.expires_at') IS NULL OR julianday(json_extract(content.lifecycle, '$.expires_at')) > julianday('now'))
      AND (
        (content.category = 'setlist_flash' AND event.state IN ('setlist_confirmed', 'digest_ready', 'archived')) OR
        (content.category IN ('live_digest', 'member_focus', 'song_focus') AND event.state = 'digest_ready') OR
        (
          content.category IN ('event_notice','event_reminder','youtube_notice')
          AND content.source_type = 'manual'
          AND json_array_length(content.song_ids) = 0
          AND json_array_length(content.member_ids) = 0
          AND json_array_length(NEW.media_asset_ids) = 0
          AND EXISTS (
            SELECT 1 FROM cubelic_manual_authorities AS authority
            WHERE authority.content_id = content.content_id
              AND authority.rights_confirmed = 1
              AND authority.privacy_review_completed = 1
              AND authority.link_validated = 1
              AND authority.destination_url = json_extract(content.destination, '$.base_url')
          )
        )
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
BEGIN
  SELECT RAISE(ABORT, 'cubelic draft approval gates failed');
END;
