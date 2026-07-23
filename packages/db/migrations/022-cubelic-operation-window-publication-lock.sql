-- Keep content-ingestion windows and X delivery mutually exclusive.

CREATE TRIGGER IF NOT EXISTS cubelic_operation_window_publication_insert
BEFORE INSERT ON cubelic_publication_jobs
WHEN EXISTS (
  SELECT 1 FROM cubelic_system_flags
  WHERE key IN ('operation_window_event_id', 'operation_window_expires_at')
)
BEGIN
  SELECT RAISE(ABORT, 'cubelic operation window blocks publication');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_operation_window_publication_update
BEFORE UPDATE ON cubelic_publication_jobs
WHEN
  EXISTS (
    SELECT 1 FROM cubelic_system_flags
    WHERE key IN ('operation_window_event_id', 'operation_window_expires_at')
  )
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
  SELECT RAISE(ABORT, 'cubelic operation window blocks publication');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_operation_window_rejects_publishing_insert
BEFORE INSERT ON cubelic_system_flags
WHEN
  NEW.key IN ('operation_window_event_id', 'operation_window_expires_at')
  AND EXISTS (
    SELECT 1 FROM cubelic_publication_jobs WHERE status = 'publishing'
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic publication in progress blocks operation window');
END;

CREATE TRIGGER IF NOT EXISTS cubelic_operation_window_rejects_publishing_update
BEFORE UPDATE ON cubelic_system_flags
WHEN
  NEW.key IN ('operation_window_event_id', 'operation_window_expires_at')
  AND EXISTS (
    SELECT 1 FROM cubelic_publication_jobs WHERE status = 'publishing'
  )
BEGIN
  SELECT RAISE(ABORT, 'cubelic publication in progress blocks operation window');
END;
