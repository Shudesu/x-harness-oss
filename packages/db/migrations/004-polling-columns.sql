-- Add polling strategy columns to engagement_gates
ALTER TABLE engagement_gates ADD COLUMN polling_strategy TEXT DEFAULT 'hot_window';
ALTER TABLE engagement_gates ADD COLUMN expires_at TEXT;
ALTER TABLE engagement_gates ADD COLUMN next_poll_at TEXT;
ALTER TABLE engagement_gates ADD COLUMN api_calls_total INTEGER DEFAULT 0;

-- Index for efficient cron scheduling queries
CREATE INDEX IF NOT EXISTS idx_engagement_gates_next_poll ON engagement_gates(next_poll_at, is_active);
