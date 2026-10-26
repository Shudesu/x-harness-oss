-- Additive: legacy gates and their history remain intact.
ALTER TABLE engagement_gates ADD COLUMN gate_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE engagement_gates ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_gate_slug ON engagement_gates(slug) WHERE slug IS NOT NULL;
ALTER TABLE engagement_gates ADD COLUMN title TEXT;
ALTER TABLE engagement_gates ADD COLUMN hero_image_url TEXT;
ALTER TABLE engagement_gates ADD COLUMN ends_at TEXT;
ALTER TABLE engagement_gates ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE engagement_gates ADD COLUMN line_connection_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN reply_hashtag TEXT;
ALTER TABLE engagement_gates ADD COLUMN claim_phrase TEXT NOT NULL DEFAULT '';
ALTER TABLE engagement_gates ADD COLUMN award_mode TEXT NOT NULL DEFAULT 'first_come';
ALTER TABLE engagement_gates ADD COLUMN settle_sec INTEGER NOT NULL DEFAULT 60;
ALTER TABLE engagement_gates ADD COLUMN min_account_age_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE engagement_gates ADD COLUMN min_followers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_gates ADD COLUMN brand_username TEXT;
ALTER TABLE engagement_gates ADD COLUMN budget_usd REAL NOT NULL DEFAULT 10;
ALTER TABLE engagement_gates ADD COLUMN tracked_link_ref TEXT;
ALTER TABLE engagement_gates ADD COLUMN gate_state TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE engagement_gates ADD COLUMN last_claim_at INTEGER;
ALTER TABLE engagement_gates ADD COLUMN last_code_check_at INTEGER;
ALTER TABLE engagement_gates ADD COLUMN last_overlap_at INTEGER;
ALTER TABLE engagement_gates ADD COLUMN scan_cursor TEXT;
ALTER TABLE engagement_gates ADD COLUMN scan_newest_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN scan_mode TEXT;
ALTER TABLE engagement_gates ADD COLUMN pause_reason TEXT;
ALTER TABLE line_connections ADD COLUMN integration_secret TEXT;
ALTER TABLE line_connections ADD COLUMN line_account_id TEXT;
CREATE TABLE gate_participants (
 id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES engagement_gates(id), line_friend_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_reply', x_user_id TEXT, x_username TEXT,
 outcome TEXT, reward_id TEXT, rank INTEGER, remaining INTEGER, missing TEXT NOT NULL DEFAULT '[]',
 retry_at INTEGER, verify_attempts INTEGER NOT NULL DEFAULT 0, verified_at INTEGER, finalized_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(gate_id,line_friend_id)
);
CREATE UNIQUE INDEX idx_gate_participant_x ON gate_participants(gate_id,x_user_id) WHERE x_user_id IS NOT NULL;
CREATE TABLE claim_codes (
 id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES gate_participants(id), gate_id TEXT NOT NULL,
 code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_reply', x_user_id TEXT, x_username TEXT,
 reply_tweet_id TEXT, reply_created_at INTEGER, author_json TEXT, matched_at INTEGER,
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, reject_reason TEXT, UNIQUE(gate_id,code)
);
CREATE UNIQUE INDEX idx_claim_active_participant ON claim_codes(participant_id) WHERE status != 'expired';
CREATE UNIQUE INDEX idx_claim_x ON claim_codes(gate_id,x_user_id) WHERE x_user_id IS NOT NULL;
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
CREATE TABLE gate_events (
 id TEXT PRIMARY KEY, gate_id TEXT NOT NULL, participant_id TEXT, session_id TEXT,
 type TEXT NOT NULL, at INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}', dedup_key TEXT UNIQUE
);
CREATE INDEX idx_gate_events ON gate_events(gate_id,type,at);
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
CREATE TRIGGER gate_settlement_guard BEFORE INSERT ON gate_settlements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_locks WHERE gate_id=NEW.gate_id AND owner=NEW.lock_owner) THEN RAISE(ABORT,'gate_lock_lost') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_participants WHERE id=NEW.participant_id AND gate_id=NEW.gate_id AND status='verified' AND finalized_at IS NULL) THEN RAISE(ABORT,'participant_not_verified') END;
END;
-- Preserve previously issued legacy tokens; only new tokens receive the 14-day TTL.
ALTER TABLE engagement_gate_deliveries ADD COLUMN expires_at TEXT;
ALTER TABLE engagement_gates ADD COLUMN archived_at INTEGER;
CREATE UNIQUE INDEX idx_claim_code_instance ON claim_codes(code);
UPDATE engagement_gates SET is_active=0,pause_reason='legacy_delivery_requires_migration' WHERE gate_mode='legacy' AND (action_type='dm' OR (action_type='mention_post' AND (trigger_type!='reply' OR COALESCE(link,'')!='')));
ALTER TABLE engagement_gates ADD COLUMN scan_start_at TEXT;
ALTER TABLE engagement_gates ADD COLUMN campaign_post_cost_usd REAL;
ALTER TABLE engagement_gates ADD COLUMN campaign_external_cost_usd REAL;
CREATE TABLE gate_metric_jobs(gate_id TEXT PRIMARY KEY,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
