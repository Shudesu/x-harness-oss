-- DG-026: reconcile an outcome-unknown publication without lifting the D1 stop.

CREATE TABLE IF NOT EXISTS cubelic_publication_reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES cubelic_publication_jobs(job_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('not_published','published')),
  status TEXT NOT NULL CHECK (status IN ('pending','completed')),
  actor TEXT NOT NULL,
  recent_posts_checked INTEGER,
  post_id_match_found INTEGER,
  fixed_text_prefix_match_found INTEGER,
  retry_idempotency_key TEXT,
  post_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (
      outcome = 'not_published'
      AND recent_posts_checked >= 10
      AND post_id_match_found = 0
      AND fixed_text_prefix_match_found = 0
      AND retry_idempotency_key IS NOT NULL
      AND post_id IS NULL
      AND published_at IS NULL
    )
    OR
    (
      outcome = 'published'
      AND recent_posts_checked IS NULL
      AND post_id_match_found IS NULL
      AND fixed_text_prefix_match_found IS NULL
      AND retry_idempotency_key IS NULL
      AND post_id IS NOT NULL
      AND post_id GLOB '[1-9]*'
      AND post_id NOT GLOB '*[^0-9]*'
      AND published_at IS NOT NULL
      AND julianday(published_at) IS NOT NULL
    )
  ),
  CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE TRIGGER IF NOT EXISTS cubelic_reconciliation_start_guard
BEFORE INSERT ON cubelic_publication_reconciliations
WHEN
  NOT EXISTS (
    SELECT 1 FROM cubelic_system_flags
    WHERE key = 'emergency_stop' AND value = 'true'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cubelic_publication_jobs AS job
    JOIN cubelic_draft_posts AS draft ON draft.draft_id = job.draft_id
    WHERE job.job_id = NEW.job_id
      AND job.status = 'publishing'
      AND job.post_id IS NULL
      AND draft.approval_status = 'approved'
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic reconciliation requires a stopped outcome-unknown job');
END;

DROP TRIGGER IF EXISTS cubelic_stop_publication_update;
CREATE TRIGGER cubelic_stop_publication_update
BEFORE UPDATE ON cubelic_publication_jobs
WHEN
  COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
  AND NOT EXISTS (
    SELECT 1
    FROM cubelic_publication_reconciliations AS reconciliation
    WHERE reconciliation.job_id = OLD.job_id
      AND reconciliation.status = 'pending'
      AND OLD.status = 'publishing'
      AND OLD.post_id IS NULL
      AND NEW.job_id IS OLD.job_id
      AND NEW.draft_id IS OLD.draft_id
      AND NEW.operation IS OLD.operation
      AND NEW.authorization_kind IS OLD.authorization_kind
      AND NEW.policy_id IS OLD.policy_id
      AND NEW.authorized_by IS OLD.authorized_by
      AND NEW.authorized_at IS OLD.authorized_at
      AND NEW.scheduled_at IS OLD.scheduled_at
      AND NEW.claim_token IS OLD.claim_token
      AND NEW.idempotency_key IS OLD.idempotency_key
      AND NEW.created_at IS OLD.created_at
      AND (
        (
          reconciliation.outcome = 'not_published'
          AND NEW.status = 'failed'
          AND NEW.failure_code = 'reconciled_no_matching_post'
          AND NEW.post_id IS NULL
          AND NEW.published_at IS OLD.published_at
        )
        OR
        (
          reconciliation.outcome = 'published'
          AND NEW.status = 'published'
          AND NEW.failure_code IS OLD.failure_code
          AND NEW.post_id = reconciliation.post_id
          AND NEW.published_at = reconciliation.published_at
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;

DROP TRIGGER IF EXISTS cubelic_stop_drafts_update;
CREATE TRIGGER cubelic_stop_drafts_update
BEFORE UPDATE ON cubelic_draft_posts
WHEN
  COALESCE((SELECT value FROM cubelic_system_flags WHERE key = 'emergency_stop'), 'true') <> 'false'
  AND NOT EXISTS (
    SELECT 1
    FROM cubelic_publication_reconciliations AS reconciliation
    JOIN cubelic_publication_jobs AS job ON job.job_id = reconciliation.job_id
    WHERE reconciliation.status = 'pending'
      AND reconciliation.outcome = 'not_published'
      AND job.draft_id = OLD.draft_id
      AND job.status = 'failed'
      AND job.failure_code = 'reconciled_no_matching_post'
      AND OLD.approval_status = 'approved'
      AND NEW.draft_id IS OLD.draft_id
      AND NEW.content_id IS OLD.content_id
      AND NEW.account_id IS OLD.account_id
      AND NEW.text IS OLD.text
      AND NEW.media_asset_ids IS OLD.media_asset_ids
      AND NEW.category IS OLD.category
      AND NEW.template_id IS OLD.template_id
      AND NEW.template_version IS OLD.template_version
      AND NEW.variant IS OLD.variant
      AND NEW.target_stage IS OLD.target_stage
      AND NEW.emotion_tags IS OLD.emotion_tags
      AND NEW.hashtags IS OLD.hashtags
      AND NEW.destination_url IS OLD.destination_url
      AND NEW.utm IS OLD.utm
      AND NEW.quality_score IS OLD.quality_score
      AND NEW.quality_breakdown IS OLD.quality_breakdown
      AND NEW.freshness_score IS OLD.freshness_score
      AND NEW.rights_gate IS OLD.rights_gate
      AND NEW.approval_status IS OLD.approval_status
      AND NEW.risks IS OLD.risks
      AND NEW.human_review_required IS OLD.human_review_required
      AND NEW.reject_reason IS OLD.reject_reason
      AND NEW.idempotency_key <> OLD.idempotency_key
      AND NEW.idempotency_key = reconciliation.retry_idempotency_key
      AND NEW.approved_by IS OLD.approved_by
      AND NEW.approved_at IS OLD.approved_at
      AND NEW.x_harness_inbox_id IS OLD.x_harness_inbox_id
      AND NEW.scheduled_at IS OLD.scheduled_at
      AND NEW.published_post_id IS OLD.published_post_id
      AND NEW.created_at IS OLD.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic emergency stop active');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_reconciliation_completion_guard
BEFORE UPDATE OF status ON cubelic_publication_reconciliations
WHEN NEW.status = 'completed' AND (
  OLD.status <> 'pending'
  OR NOT EXISTS (
    SELECT 1 FROM cubelic_system_flags
    WHERE key = 'emergency_stop' AND value = 'true'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cubelic_publication_jobs AS job
    WHERE job.job_id = NEW.job_id
      AND (
        (
          NEW.outcome = 'not_published'
          AND job.status = 'failed'
          AND job.failure_code = 'reconciled_no_matching_post'
          AND EXISTS (
            SELECT 1 FROM cubelic_draft_posts AS draft
            WHERE draft.draft_id = job.draft_id
              AND draft.approval_status = 'approved'
              AND draft.idempotency_key = NEW.retry_idempotency_key
          )
        )
        OR
        (
          NEW.outcome = 'published'
          AND job.status = 'published'
          AND job.post_id = NEW.post_id
          AND job.published_at = NEW.published_at
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'cubelic reconciliation did not complete atomically');
END;
