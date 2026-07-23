-- CUBΣLIC Phase 1 hardening: missing or malformed emergency-stop state is stopped.
-- Recreate existing triggers because SQLite's IF NOT EXISTS does not update them.
INSERT OR IGNORE INTO cubelic_audit_logs (
  audit_id, actor, action, entity_type, entity_id,
  before_json, after_json, timestamp, correlation_id
)
SELECT
  'aud_migration019_emergency_stop_default', 'system', 'system.emergency_stop_defaulted',
  'system', 'publishing', '{}', '{"stopped":true,"reason":"missing_flag"}',
  '2026-07-23T00:00:00.000Z', 'migration_019'
WHERE NOT EXISTS (
  SELECT 1 FROM cubelic_system_flags WHERE key = 'emergency_stop'
);

INSERT OR IGNORE INTO cubelic_system_flags (key, value, updated_at, updated_by)
VALUES ('emergency_stop', 'true', '2026-07-23T00:00:00.000Z', 'migration_019');

INSERT OR IGNORE INTO cubelic_audit_logs (
  audit_id, actor, action, entity_type, entity_id,
  before_json, after_json, timestamp, correlation_id
)
SELECT
  'aud_migration019_emergency_stop_invalid', 'system', 'system.emergency_stop_defaulted',
  'system', 'publishing', json_object('value', value),
  '{"stopped":true,"reason":"invalid_flag"}',
  '2026-07-23T00:00:00.000Z', 'migration_019'
FROM cubelic_system_flags
WHERE key = 'emergency_stop' AND value NOT IN ('true', 'false');

UPDATE cubelic_system_flags
SET value = 'true', updated_at = '2026-07-23T00:00:00.000Z', updated_by = 'migration_019'
WHERE key = 'emergency_stop' AND value NOT IN ('true', 'false');

DROP TRIGGER IF EXISTS cubelic_stop_events_insert;
DROP TRIGGER IF EXISTS cubelic_stop_events_update;
DROP TRIGGER IF EXISTS cubelic_stop_songs_insert;
DROP TRIGGER IF EXISTS cubelic_stop_songs_update;
DROP TRIGGER IF EXISTS cubelic_stop_members_insert;
DROP TRIGGER IF EXISTS cubelic_stop_members_update;
DROP TRIGGER IF EXISTS cubelic_stop_content_insert;
DROP TRIGGER IF EXISTS cubelic_stop_content_update;
DROP TRIGGER IF EXISTS cubelic_stop_media_insert;
DROP TRIGGER IF EXISTS cubelic_stop_media_update;
DROP TRIGGER IF EXISTS cubelic_stop_setlists_insert;
DROP TRIGGER IF EXISTS cubelic_stop_drafts_insert;
DROP TRIGGER IF EXISTS cubelic_stop_drafts_update;
DROP TRIGGER IF EXISTS cubelic_stop_inbox_insert;
DROP TRIGGER IF EXISTS cubelic_stop_post_mapping_insert;

CREATE TRIGGER cubelic_stop_events_insert BEFORE INSERT ON cubelic_events
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_events_update BEFORE UPDATE ON cubelic_events
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_songs_insert BEFORE INSERT ON cubelic_songs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_songs_update BEFORE UPDATE ON cubelic_songs
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_members_insert BEFORE INSERT ON cubelic_members
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_members_update BEFORE UPDATE ON cubelic_members
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_content_insert BEFORE INSERT ON cubelic_content_items
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_content_update BEFORE UPDATE ON cubelic_content_items
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_media_insert BEFORE INSERT ON cubelic_media_assets
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_media_update BEFORE UPDATE ON cubelic_media_assets
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_setlists_insert BEFORE INSERT ON cubelic_setlists
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_drafts_insert BEFORE INSERT ON cubelic_draft_posts
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_drafts_update BEFORE UPDATE ON cubelic_draft_posts
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_inbox_insert BEFORE INSERT ON cubelic_x_draft_inbox
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
CREATE TRIGGER cubelic_stop_post_mapping_insert BEFORE INSERT ON cubelic_post_mappings
WHEN COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;
