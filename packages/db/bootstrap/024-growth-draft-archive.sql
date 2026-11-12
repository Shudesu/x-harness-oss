-- 024: archive expired approval-queue drafts without deleting them.
-- Additive only. A pending draft with archived_at set is "archived": it is
-- hidden from the queue (status=pending lists) but keeps every field, so
-- clearing archived_at restores it exactly. status keeps its CHECK list
-- (pending/scheduled/rejected) because SQLite cannot alter a CHECK in place.
ALTER TABLE growth_drafts ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_growth_drafts_archived ON growth_drafts(status, archived_at);
