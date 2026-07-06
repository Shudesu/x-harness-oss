-- X Activity API (XAA) webhook events — post.create / post.delete / DM etc.
-- Raw payloads are kept so new event types need no schema change.
CREATE TABLE IF NOT EXISTS xaa_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xaa_events_type_time ON xaa_events (event_type, received_at DESC);
