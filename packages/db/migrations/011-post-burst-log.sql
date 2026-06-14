-- Burst guard: per-post event log for velocity-based rate limiting (Issue #3233)
--
-- Records every actual tweet creation with a precise timestamp so the
-- immediate-post path can count how many posts an account made within a recent
-- time window and refuse to fire when the velocity exceeds the burst limit.
--
-- api_usage_logs is aggregated by (x_account_id, endpoint, date) and therefore
-- cannot answer "how many posts in the last N minutes" — only "how many today".
-- The 2026-06-11 13連発 incident (13 distinct posts fired in minutes) is a
-- velocity signal, not a daily-volume signal, so a dedicated timestamped log is
-- required. posted_at is a JST ISO string (fixed-width) for lexicographic range
-- comparison.
CREATE TABLE IF NOT EXISTS post_burst_log (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'immediate'
);
CREATE INDEX IF NOT EXISTS idx_post_burst_account_time ON post_burst_log (x_account_id, posted_at);
