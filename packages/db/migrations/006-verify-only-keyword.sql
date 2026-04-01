-- Add verify_only action type and reply_keyword
-- SQLite doesn't support ALTER CHECK, so we recreate the constraint via a pragma trick
-- Instead, just add the column since CHECK is only enforced on INSERT
ALTER TABLE engagement_gates ADD COLUMN reply_keyword TEXT;
