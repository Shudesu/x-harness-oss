CREATE TABLE IF NOT EXISTS growth_articles (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  image_url TEXT,
  theme TEXT,
  source_tweet_ids TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  published_article_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_articles_status ON growth_articles(status);
ALTER TABLE source_candidates ADD COLUMN transcript TEXT;
