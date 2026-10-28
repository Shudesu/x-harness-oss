-- Fresh-install schema matching the bootstrap migration chain.
CREATE TABLE api_usage_logs (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(x_account_id, endpoint, date)
);

CREATE TABLE engagement_actions (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('like', 'repost', 'reply')),
  created_at TEXT NOT NULL,
  UNIQUE(x_account_id, tweet_id, action_type)
);

CREATE TABLE engagement_gate_deliveries (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  x_username TEXT,
  delivered_post_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('delivered', 'failed', 'pending')),
  token TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL, expires_at TEXT,
  UNIQUE(gate_id, x_user_id)
);

CREATE TABLE "engagement_gates" (
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
, delivery_method TEXT NOT NULL DEFAULT 'reply_with_link', reply_templates TEXT, consecutive_empty_polls INTEGER NOT NULL DEFAULT 0, last_like_count INTEGER, last_rt_count INTEGER, gate_mode TEXT NOT NULL DEFAULT 'legacy', slug TEXT, title TEXT, hero_image_url TEXT, ends_at TEXT, tier TEXT NOT NULL DEFAULT 'standard', line_connection_id TEXT, reply_hashtag TEXT, claim_phrase TEXT NOT NULL DEFAULT '', award_mode TEXT NOT NULL DEFAULT 'first_come', settle_sec INTEGER NOT NULL DEFAULT 60, min_account_age_days INTEGER NOT NULL DEFAULT 7, min_followers INTEGER NOT NULL DEFAULT 0, brand_username TEXT, budget_usd REAL NOT NULL DEFAULT 10, tracked_link_ref TEXT, gate_state TEXT NOT NULL DEFAULT 'draft', last_claim_at INTEGER, last_code_check_at INTEGER, last_overlap_at INTEGER, scan_cursor TEXT, scan_newest_id TEXT, scan_mode TEXT, pause_reason TEXT, archived_at INTEGER, scan_start_at TEXT, campaign_post_cost_usd REAL, campaign_external_cost_usd REAL, entry_page TEXT NOT NULL DEFAULT 'redirect' CHECK(entry_page IN ('redirect','status')), message_templates TEXT, loser_followup TEXT, follow_policy TEXT NOT NULL DEFAULT 'none' CHECK(follow_policy IN ('none','ask','verify_winners')), like_policy TEXT NOT NULL DEFAULT 'none' CHECK(like_policy IN ('none','ask','verify_winners')));

CREATE TABLE follower_id_cache (
  x_account_id TEXT NOT NULL,
  follower_x_user_id TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x_account_id, follower_x_user_id)
);

CREATE TABLE follower_snapshots (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  followers_count INTEGER NOT NULL,
  following_count INTEGER NOT NULL,
  tweet_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (x_account_id) REFERENCES x_accounts(id)
);

CREATE TABLE follower_tags (
  follower_id TEXT NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, tag_id)
);

CREATE TABLE followers (
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

CREATE TABLE growth_articles (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  image_url TEXT,
  theme TEXT,
  source_tweet_ids TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  x_article_draft_id TEXT,
  published_article_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE growth_digests (
  date TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE growth_drafts (
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

CREATE TABLE quote_tweets (
  id TEXT PRIMARY KEY,
  source_tweet_id TEXT NOT NULL,
  x_account_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_username TEXT,
  author_display_name TEXT,
  author_profile_image_url TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  FOREIGN KEY (x_account_id) REFERENCES x_accounts(id)
);

CREATE TABLE replier_cache (
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

CREATE TABLE scheduled_posts (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  media_ids TEXT,
  quote_tweet_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posted', 'failed')),
  posted_tweet_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_candidates (
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
  transcript TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'dismissed')),
  discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE staff_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  api_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, api_key_hash TEXT);

CREATE TABLE step_enrollments (
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

CREATE TABLE step_messages (
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

CREATE TABLE step_sequences (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  created_at TEXT NOT NULL,
  UNIQUE(x_account_id, name)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE x_accounts (
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
, token_expires_at INTEGER, needs_reauth INTEGER NOT NULL DEFAULT 0, oauth_client_id TEXT, oauth_client_secret TEXT);

CREATE TABLE xaa_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scheduled_post_claims (post_id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL);

CREATE TABLE rate_counters (key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key,window_start));

CREATE TABLE user_search_cache (cache_key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);

CREATE TABLE api_spend_ledger (id TEXT PRIMARY KEY, date_utc TEXT NOT NULL, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, endpoint TEXT NOT NULL, resource_type TEXT NOT NULL, units INTEGER NOT NULL, unit_cost_usd REAL NOT NULL, cost_usd REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE ai_runs (id TEXT PRIMARY KEY, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, x_posts_fetched INTEGER NOT NULL, x_users_fetched INTEGER NOT NULL, cost_usd REAL NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE ai_outputs (id TEXT PRIMARY KEY, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, ref_id TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(x_account_id,feature,ref_id));

CREATE TABLE ai_locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);

CREATE TABLE post_cache (x_account_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(x_account_id,id,kind));

CREATE TABLE engager_cache (gate_id TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, first_seen_at INTEGER NOT NULL, PRIMARY KEY(gate_id,kind,user_id));

CREATE TABLE reply_trigger_queue (gate_id TEXT NOT NULL, tweet_id TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(gate_id,tweet_id));

CREATE TABLE line_connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,worker_url TEXT NOT NULL,api_key TEXT NOT NULL,created_at TEXT NOT NULL, integration_secret TEXT, line_account_id TEXT);

CREATE TABLE oauth_states(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);

CREATE TABLE gate_participants (
 id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES engagement_gates(id), line_friend_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_reply', x_user_id TEXT, x_username TEXT,
 outcome TEXT, reward_id TEXT, rank INTEGER, remaining INTEGER, missing TEXT NOT NULL DEFAULT '[]',
 retry_at INTEGER, verify_attempts INTEGER NOT NULL DEFAULT 0, verified_at INTEGER, finalized_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(gate_id,line_friend_id)
);

CREATE TABLE claim_codes (
 id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES gate_participants(id), gate_id TEXT NOT NULL,
 code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_reply', x_user_id TEXT, x_username TEXT,
 reply_tweet_id TEXT, reply_created_at INTEGER, author_json TEXT, matched_at INTEGER,
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, reject_reason TEXT, UNIQUE(gate_id,code)
);

CREATE TABLE gate_rewards (
 id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES engagement_gates(id), tier INTEGER NOT NULL,
 label TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('coupon_code','url','line_message','file')),
 value_template TEXT NOT NULL, quota INTEGER CHECK(quota IS NULL OR quota>=0), issued INTEGER NOT NULL DEFAULT 0,
 weight REAL NOT NULL DEFAULT 1 CHECK(weight>=0), is_consolation INTEGER NOT NULL DEFAULT 0,
 unit_cost REAL, UNIQUE(gate_id,tier)
);

CREATE TABLE reward_codes (
 id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES gate_rewards(id), code TEXT NOT NULL,
 assigned_participant_id TEXT UNIQUE, UNIQUE(reward_id,code)
);

CREATE TABLE gate_allocations (
 participant_id TEXT PRIMARY KEY REFERENCES gate_participants(id), reward_id TEXT NOT NULL REFERENCES gate_rewards(id),
 gate_id TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE gate_events (
 id TEXT PRIMARY KEY, gate_id TEXT NOT NULL, participant_id TEXT, session_id TEXT,
 type TEXT NOT NULL, at INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}', dedup_key TEXT UNIQUE
);

CREATE TABLE gate_locks (gate_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE gate_reply_candidates (gate_id TEXT NOT NULL,tweet_id TEXT NOT NULL,code TEXT,created_at INTEGER NOT NULL,author_id TEXT NOT NULL,result TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(gate_id,tweet_id));

CREATE TABLE gate_condition_cache (gate_id TEXT NOT NULL,x_user_id TEXT NOT NULL,condition TEXT NOT NULL,value INTEGER NOT NULL,checked_at INTEGER NOT NULL,retry_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(gate_id,x_user_id,condition));

CREATE TABLE event_outbox (
 id TEXT PRIMARY KEY,gate_id TEXT NOT NULL,participant_id TEXT,event TEXT NOT NULL,payload TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,last_error TEXT,status TEXT NOT NULL DEFAULT 'pending',
 locked_until INTEGER,lock_owner TEXT,created_at INTEGER NOT NULL, UNIQUE(participant_id,event)
);

CREATE TABLE gate_partner_receipts (delivery_id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,body_hash TEXT NOT NULL,event TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TABLE gate_settlements(participant_id TEXT PRIMARY KEY,gate_id TEXT NOT NULL,lock_owner TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TABLE gate_metric_jobs(gate_id TEXT PRIMARY KEY,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);

CREATE TABLE campaign_digests (
 id TEXT PRIMARY KEY, gate_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('ended','weekly','budget')),
 period_key TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('line','slack','email')),
 lines TEXT NOT NULL, generated INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,last_error TEXT,created_at INTEGER NOT NULL,sent_at INTEGER,
 lock_owner TEXT,locked_until INTEGER, connection_id TEXT,
 UNIQUE(gate_id,kind,period_key,channel)
);

CREATE TABLE campaign_digest_tests(gate_id TEXT NOT NULL,channel TEXT NOT NULL,last_at INTEGER NOT NULL,PRIMARY KEY(gate_id,channel));

CREATE TABLE gate_followup_allocations(participant_id TEXT PRIMARY KEY REFERENCES gate_participants(id),gate_id TEXT NOT NULL,reward_id TEXT NOT NULL REFERENCES gate_rewards(id),value TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TABLE campaign_digest_email_receipts(digest_id TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(digest_id,recipient));

CREATE TABLE claim_search_cursors(x_account_id TEXT PRIMARY KEY,since_id TEXT,scan_cursor TEXT,scan_newest_id TEXT,scan_mode TEXT,scan_start_at TEXT,last_overlap_at INTEGER,gate_set_hash TEXT,updated_at INTEGER NOT NULL,gate_ids TEXT NOT NULL DEFAULT '[]',query_index INTEGER NOT NULL DEFAULT 0,queries TEXT,lease_owner TEXT,lease_until INTEGER);

CREATE INDEX idx_deliveries_gate_id ON engagement_gate_deliveries(gate_id);

CREATE INDEX idx_followers_x_user_id ON followers(x_user_id);

CREATE INDEX idx_followers_user_id ON followers(user_id);

CREATE INDEX idx_follower_tags_tag_id ON follower_tags(tag_id);

CREATE INDEX idx_scheduled_posts_status ON scheduled_posts(status);

CREATE UNIQUE INDEX idx_deliveries_token ON engagement_gate_deliveries(token);

CREATE INDEX idx_step_messages_sequence ON step_messages(sequence_id, step_order);

CREATE INDEX idx_follower_snapshots_account_date ON follower_snapshots(x_account_id, recorded_at);

CREATE INDEX idx_quote_tweets_source ON quote_tweets(source_tweet_id);

CREATE INDEX idx_quote_tweets_account ON quote_tweets(x_account_id, discovered_at DESC);

CREATE INDEX idx_engagement_actions_account ON engagement_actions(x_account_id);

CREATE INDEX idx_growth_drafts_status ON growth_drafts(status);

CREATE INDEX idx_source_candidates_status ON source_candidates(status);

CREATE INDEX idx_growth_articles_status ON growth_articles(status);

CREATE INDEX idx_step_enrollments_next_run ON step_enrollments(next_run_at, status);

CREATE INDEX idx_engagement_gates_active ON engagement_gates(is_active);

CREATE INDEX idx_engagement_gates_next_poll ON engagement_gates(next_poll_at, is_active);

CREATE INDEX idx_staff_api_key ON staff_members (api_key);

CREATE INDEX idx_usage_account_date ON api_usage_logs (x_account_id, date);

CREATE INDEX idx_replier_cache_gate_eligible
  ON replier_cache (gate_id, eligible);

CREATE INDEX idx_xaa_events_type_time ON xaa_events (event_type, received_at DESC);

CREATE UNIQUE INDEX idx_staff_hash ON staff_members(api_key_hash);

CREATE INDEX idx_spend_month ON api_spend_ledger(source,date_utc);

CREATE UNIQUE INDEX idx_gate_slug ON engagement_gates(slug) WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX idx_gate_participant_x ON gate_participants(gate_id,x_user_id) WHERE x_user_id IS NOT NULL;

CREATE UNIQUE INDEX idx_claim_active_participant ON claim_codes(participant_id) WHERE status != 'expired';

CREATE UNIQUE INDEX idx_claim_x ON claim_codes(gate_id,x_user_id) WHERE x_user_id IS NOT NULL;

CREATE INDEX idx_gate_events ON gate_events(gate_id,type,at);

CREATE UNIQUE INDEX idx_claim_code_instance ON claim_codes(code);

CREATE UNIQUE INDEX campaign_digest_identity ON campaign_digests(COALESCE(gate_id,''),kind,period_key,channel,COALESCE(connection_id,''));

CREATE INDEX campaign_digest_due ON campaign_digests(status,next_at);

CREATE TRIGGER gate_allocation_capacity BEFORE INSERT ON gate_allocations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_rewards WHERE id=NEW.reward_id AND gate_id=NEW.gate_id AND (quota IS NULL OR issued<quota)) THEN RAISE(ABORT,'reward_exhausted') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM gate_rewards WHERE id=NEW.reward_id AND type='coupon_code') AND NOT EXISTS(SELECT 1 FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL) THEN RAISE(ABORT,'reward_exhausted') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_participants WHERE id=NEW.participant_id AND gate_id=NEW.gate_id AND finalized_at IS NULL) THEN RAISE(ABORT,'participant_finalized') END;
END;

CREATE TRIGGER gate_allocation_commit AFTER INSERT ON gate_allocations BEGIN
 UPDATE gate_rewards SET issued=issued+1 WHERE id=NEW.reward_id;
 UPDATE reward_codes SET assigned_participant_id=NEW.participant_id WHERE id=(SELECT id FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL ORDER BY id LIMIT 1);
 UPDATE gate_allocations SET value=COALESCE((SELECT code FROM reward_codes WHERE assigned_participant_id=NEW.participant_id),value) WHERE participant_id=NEW.participant_id;
END;

CREATE TRIGGER gate_settlement_guard BEFORE INSERT ON gate_settlements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_locks WHERE gate_id=NEW.gate_id AND owner=NEW.lock_owner) THEN RAISE(ABORT,'gate_lock_lost') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_participants WHERE id=NEW.participant_id AND gate_id=NEW.gate_id AND status='verified' AND finalized_at IS NULL) THEN RAISE(ABORT,'participant_not_verified') END;
END;

CREATE TRIGGER gate_followup_capacity BEFORE INSERT ON gate_followup_allocations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_rewards r JOIN engagement_gates g ON g.id=r.gate_id WHERE r.id=NEW.reward_id AND r.gate_id=NEW.gate_id AND r.is_consolation=1 AND r.type IN ('coupon_code','url') AND (r.quota IS NULL OR r.issued<r.quota) AND json_extract(g.loser_followup,'$.couponRewardId')=r.id AND json_extract(g.loser_followup,'$.enabled')=1) THEN RAISE(ABORT,'reward_exhausted') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_participants WHERE id=NEW.participant_id AND gate_id=NEW.gate_id AND outcome='lost' AND finalized_at IS NOT NULL) THEN RAISE(ABORT,'participant_not_lost') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM gate_rewards WHERE id=NEW.reward_id AND type='coupon_code') AND NOT EXISTS(SELECT 1 FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL) THEN RAISE(ABORT,'reward_exhausted') END;
END;

CREATE TRIGGER gate_followup_commit AFTER INSERT ON gate_followup_allocations BEGIN
 UPDATE gate_rewards SET issued=issued+1 WHERE id=NEW.reward_id;
 UPDATE reward_codes SET assigned_participant_id='followup:'||NEW.participant_id WHERE id=(SELECT id FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL ORDER BY id LIMIT 1);
 UPDATE gate_followup_allocations SET value=COALESCE((SELECT code FROM reward_codes WHERE assigned_participant_id='followup:'||NEW.participant_id),value) WHERE participant_id=NEW.participant_id;
END;
-- Opt-in external observations; existing gates keep their paid API polling mode.
CREATE TABLE gate_external_sources(
 gate_id TEXT PRIMARY KEY REFERENCES engagement_gates(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 epoch TEXT NOT NULL,
 enabled_at INTEGER NOT NULL,
 scan_id TEXT, scan_expires_at INTEGER, scan_from INTEGER, scan_until INTEGER,
 next_page INTEGER NOT NULL DEFAULT 0, next_token TEXT,
 last_complete_at INTEGER, coverage_until INTEGER
);
CREATE TABLE gate_external_receipts(
 scan_id TEXT NOT NULL, page INTEGER NOT NULL, gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
 digest TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(scan_id,page)
);
