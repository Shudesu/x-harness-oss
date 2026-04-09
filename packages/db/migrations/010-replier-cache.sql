-- Cache for engagement gate replier eligibility.
-- Read-through cache: first request fetches from X API and stores here,
-- subsequent requests serve from cache until TTL expires.
CREATE TABLE IF NOT EXISTS replier_cache (
  gate_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  profile_image_url TEXT,
  eligible INTEGER NOT NULL DEFAULT 0,
  conditions_json TEXT,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (gate_id, x_user_id)
);

CREATE INDEX IF NOT EXISTS idx_replier_cache_gate_eligible
  ON replier_cache (gate_id, eligible);
