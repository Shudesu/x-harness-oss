# ADR-009 — Add a default-disabled Phase 3 publication boundary

- Status: Accepted
- Date: 2026-07-23

## Context

Phase 1 intentionally ends at an inert X Harness inbox. DG-024 authorizes a later capability for human-approved immediate publication, allowlisted pre-approved-template scheduling, human-attested manual input, and normally resumed operation without removing emergency controls.

The upstream legacy routes call X directly and do not prove CUBΣLIC rights, privacy, approval, audit, idempotency, or rate-policy compliance. They cannot be reused as the CUBΣLIC publication surface.

## Decision

Add a separate `Phase3XPublishingAdapter` and CUBΣLIC-only routes. The capability is enabled only by the exact `CUBELIC_PHASE3_ENABLED=true` setting. Legacy X write routes remain blocked.

Immediate publication requires an individually approved draft and a named human authorization. Scheduling requires a reviewed `category:template_id` policy pair, and the policy identifier must equal that template ID. Both paths fail closed on environment stop, D1 stop, malformed approval, rights/privacy/link failure, or publication-rate rejection.

Persist publication intent before calling X. An unresolved `publishing` job is never retried automatically because the external outcome may be unknown. Scheduled execution is claimed once and audited. Manual production input requires a versioned human-attestation record.

An outcome-unknown job may be reconciled only through the DG-026
named-human administration route while the D1 emergency stop is active.
`not_published` requires evidence that at least ten recent posts were checked
and neither the expected post id nor fixed-text prefix matched; it atomically
marks the job failed and gives the approved draft a new retry idempotency key.
`published` requires the confirmed numeric X post id and ISO 8601 publication
time and completes the existing job. Reconciliation performs no X write and
never changes the D1 emergency-stop value. Migration 021 uses one persistent,
unique reconciliation record per publication job to guard the narrow stopped
transition and make duplicate or partial attempts roll back.

The first release supports text-only X delivery. CUBΣLIC media identifiers are not X media identifiers, so media publication remains blocked until a reviewed R2-to-X upload and reconciliation contract exists.

Staging may use `CUBELIC_PHASE3_DELIVERY_MODE=staging_fake` only when
`WORKER_URL` identifies the dedicated staging Worker. It records synthetic
post identifiers without calling X. Production preflight accepts only
`CUBELIC_PHASE3_DELIVERY_MODE=x`; missing, malformed, or cross-environment
delivery modes disable Phase 3.

## Consequences

- Phase 1 production behavior remains unchanged by default.
- Normal Phase 3 operation may keep the D1 stop disengaged, but missing or malformed stop state still fails closed.
- Cron may be installed while Phase 3 is disabled because the handler performs no work unless all enable conditions pass.
- Production enablement requires migrations 020 and 021, Phase 3 staging smoke, explicit release approval, and reviewed category/template allowlists.
