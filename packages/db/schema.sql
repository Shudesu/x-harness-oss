-- X Harness OSS — D1 Schema
-- Mirrors LINE Harness architecture for The Harness unification

-- X Accounts (1 deploy = 1 primary, but supports multi)
CREATE TABLE IF NOT EXISTS x_accounts (
  id TEXT PRIMARY KEY,
  x_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  consumer_key TEXT,
  consumer_secret TEXT,
  access_token_secret TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Engagement Gates (secret reply — killer feature)
CREATE TABLE IF NOT EXISTS engagement_gates (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('like', 'repost', 'reply', 'follow', 'quote')),
  action_type TEXT NOT NULL CHECK (action_type IN ('mention_post', 'dm', 'verify_only')),
  template TEXT NOT NULL,
  link TEXT,
  is_active INTEGER DEFAULT 1,
  line_harness_url TEXT,
  line_harness_api_key TEXT,
  line_harness_tag TEXT,
  line_harness_scenario_id TEXT,
  lottery_enabled INTEGER DEFAULT 0,
  lottery_rate INTEGER DEFAULT 100,
  lottery_win_template TEXT,
  lottery_lose_template TEXT,
  polling_strategy TEXT DEFAULT 'hot_window' CHECK (polling_strategy IN ('hot_window', 'constant', 'manual')),
  expires_at TEXT,
  next_poll_at TEXT,
  api_calls_total INTEGER DEFAULT 0,
  require_like INTEGER DEFAULT 0,
  require_repost INTEGER DEFAULT 0,
  require_follow INTEGER DEFAULT 0,
  last_reply_since_id TEXT,
  reply_keyword TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engagement_gates_active ON engagement_gates(is_active);
CREATE INDEX IF NOT EXISTS idx_engagement_gates_next_poll ON engagement_gates(next_poll_at, is_active);

-- Engagement Gate Deliveries (dedup tracking)
CREATE TABLE IF NOT EXISTS engagement_gate_deliveries (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT,
  delivered_post_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('delivered', 'failed', 'pending')),
  token TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(gate_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_gate_id ON engagement_gate_deliveries(gate_id);

-- Followers
CREATE TABLE IF NOT EXISTS followers (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  profile_image_url TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  is_following INTEGER DEFAULT 1,
  is_followed INTEGER DEFAULT 0,
  user_id TEXT,
  metadata TEXT DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  unfollowed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(x_account_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_followers_x_user_id ON followers(x_user_id);
CREATE INDEX IF NOT EXISTS idx_followers_user_id ON followers(user_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TEXT NOT NULL,
  UNIQUE(x_account_id, name)
);

-- Follower <-> Tag
CREATE TABLE IF NOT EXISTS follower_tags (
  follower_id TEXT NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_follower_tags_tag_id ON follower_tags(tag_id);

-- Scheduled Posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  media_ids TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posted', 'failed')),
  posted_tweet_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_token ON engagement_gate_deliveries(token);

-- Users (UUID — The Harness unification)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step Sequences
CREATE TABLE IF NOT EXISTS step_sequences (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_messages (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES step_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_minutes INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('mention_post', 'dm')),
  template TEXT NOT NULL,
  link TEXT,
  condition_tag TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_messages_sequence ON step_messages(sequence_id, step_order);

CREATE TABLE IF NOT EXISTS step_enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES step_sequences(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT,
  current_step INTEGER DEFAULT 0,
  next_run_at TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sequence_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_step_enrollments_next_run ON step_enrollments(next_run_at, status);
