-- Follower ID cache for follow-trigger verification.
-- Populated only by real getFollowers syncs (bulk-cached during verify),
-- so a row here is genuine proof the user followed at sync time.
-- Matches the table created ad hoc in production (2026-04).
CREATE TABLE IF NOT EXISTS follower_id_cache (
  x_account_id TEXT NOT NULL,
  follower_x_user_id TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x_account_id, follower_x_user_id)
);
