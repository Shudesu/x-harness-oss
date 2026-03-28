-- Add lottery fields to engagement_gates
ALTER TABLE engagement_gates ADD COLUMN lottery_enabled INTEGER DEFAULT 0;
ALTER TABLE engagement_gates ADD COLUMN lottery_rate INTEGER DEFAULT 100;
ALTER TABLE engagement_gates ADD COLUMN lottery_win_template TEXT;
ALTER TABLE engagement_gates ADD COLUMN lottery_lose_template TEXT;

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
  sequence_id TEXT NOT NULL REFERENCES step_sequences(id),
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
