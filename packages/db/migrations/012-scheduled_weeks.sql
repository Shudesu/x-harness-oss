-- 202606新規追加開始

CREATE TABLE IF NOT EXISTS scheduled_weeks (
  id TEXT PRIMARY KEY,

  x_account_id TEXT NOT NULL,

  enabled INTEGER NOT NULL DEFAULT 1,

  sort_order INTEGER NOT NULL DEFAULT 0,

  weekday INTEGER NOT NULL,

  time TEXT NOT NULL,

  text TEXT NOT NULL,

  offset INTEGER NOT NULL DEFAULT 5,

  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',

  last_posted_at TEXT,

  next_run_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (x_account_id)
    REFERENCES x_accounts(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_weeks_account
ON scheduled_weeks(x_account_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_weeks_order
ON scheduled_weeks(x_account_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_scheduled_weeks_enabled
ON scheduled_weeks(enabled);

CREATE INDEX IF NOT EXISTS idx_scheduled_weeks_next_run
ON scheduled_weeks(next_run_at, enabled);

-- 202606新規追加終了