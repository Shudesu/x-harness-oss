-- Winner-only condition checks; legacy follow intent is retained explicitly.
ALTER TABLE engagement_gates ADD COLUMN follow_policy TEXT NOT NULL DEFAULT 'none' CHECK(follow_policy IN ('none','ask','verify_winners'));
ALTER TABLE engagement_gates ADD COLUMN like_policy TEXT NOT NULL DEFAULT 'none' CHECK(like_policy IN ('none','ask','verify_winners'));
UPDATE engagement_gates SET follow_policy='verify_winners' WHERE require_follow=1;
CREATE TABLE claim_search_cursors(x_account_id TEXT PRIMARY KEY,since_id TEXT,scan_cursor TEXT,scan_newest_id TEXT,scan_mode TEXT,scan_start_at TEXT,last_overlap_at INTEGER,gate_set_hash TEXT,updated_at INTEGER NOT NULL,gate_ids TEXT NOT NULL DEFAULT '[]',query_index INTEGER NOT NULL DEFAULT 0,queries TEXT,lease_owner TEXT,lease_until INTEGER);
