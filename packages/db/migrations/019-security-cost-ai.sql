-- Additive upgrade. Existing delivery behaviour is preserved.
CREATE TABLE scheduled_post_claims (post_id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL);
UPDATE scheduled_posts SET scheduled_at = strftime('%Y-%m-%dT%H:%M:%f', scheduled_at, '+9 hours') || '+09:00'
WHERE (scheduled_at LIKE '%Z' OR substr(scheduled_at,-6,1) IN ('+','-')) AND julianday(scheduled_at) IS NOT NULL;
UPDATE scheduled_posts SET scheduled_at = replace(scheduled_at, ' ', 'T') || '+09:00'
WHERE scheduled_at NOT LIKE '%Z' AND substr(scheduled_at,-6,1) NOT IN ('+','-');
CREATE TABLE rate_counters (key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key,window_start));
CREATE TABLE user_search_cache (cache_key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);
ALTER TABLE x_accounts ADD COLUMN token_expires_at INTEGER;
ALTER TABLE x_accounts ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE x_accounts ADD COLUMN oauth_client_id TEXT;
ALTER TABLE x_accounts ADD COLUMN oauth_client_secret TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_hash TEXT;
CREATE UNIQUE INDEX idx_staff_hash ON staff_members(api_key_hash);
CREATE TABLE api_spend_ledger (id TEXT PRIMARY KEY, date_utc TEXT NOT NULL, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, endpoint TEXT NOT NULL, resource_type TEXT NOT NULL, units INTEGER NOT NULL, unit_cost_usd REAL NOT NULL, cost_usd REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_spend_month ON api_spend_ledger(source,date_utc);
CREATE TABLE ai_runs (id TEXT PRIMARY KEY, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, x_posts_fetched INTEGER NOT NULL, x_users_fetched INTEGER NOT NULL, cost_usd REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE ai_outputs (id TEXT PRIMARY KEY, x_account_id TEXT NOT NULL, feature TEXT NOT NULL, ref_id TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(x_account_id,feature,ref_id));
CREATE TABLE ai_locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE post_cache (x_account_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(x_account_id,id,kind));
CREATE TABLE engager_cache (gate_id TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, first_seen_at INTEGER NOT NULL, PRIMARY KEY(gate_id,kind,user_id));
CREATE TABLE reply_trigger_queue (gate_id TEXT NOT NULL, tweet_id TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(gate_id,tweet_id));
ALTER TABLE engagement_gates ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'reply_with_link';
UPDATE engagement_gates SET delivery_method = 'dm' WHERE action_type = 'dm';
ALTER TABLE engagement_gates ADD COLUMN reply_templates TEXT;
ALTER TABLE engagement_gates ADD COLUMN consecutive_empty_polls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_gates ADD COLUMN last_like_count INTEGER;
ALTER TABLE engagement_gates ADD COLUMN last_rt_count INTEGER;

CREATE TABLE IF NOT EXISTS line_connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,worker_url TEXT NOT NULL,api_key TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE oauth_states(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
