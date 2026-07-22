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
CREATE TABLE IF NOT EXISTS growth_digests (
  date TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
