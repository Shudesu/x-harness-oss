CREATE TABLE IF NOT EXISTS source_candidates (
  id TEXT PRIMARY KEY,
  source_tweet_id TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL,
  author_url TEXT,
  text_en TEXT NOT NULL,
  text_ja TEXT NOT NULL,
  summary_ja TEXT,
  suggested_quote_text TEXT,
  video_url TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  theme TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'dismissed')),
  discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_candidates_status ON source_candidates(status);
