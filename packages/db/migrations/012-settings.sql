-- Key-value settings store, used by the settings API and as operational
-- markers (gate cache refresh / follower sync timestamps).
-- Matches the table created ad hoc in production.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
