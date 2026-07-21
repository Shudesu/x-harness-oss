# ADR-003 — Hermes communicates through least-privilege HTTP APIs

- Status: Accepted for Phase 1 contract; runtime is Phase 2
- Date: 2026-07-21

## Decision

Hermes will call authenticated `/api/cubelic` HTTP endpoints from a fresh Cron session with an explicit repository `workdir`. It receives no human-approval or X write secret.

## Rationale

The local Hermes version runs Cron work in fresh sessions. An HTTP contract gives retries and idempotency a stable boundary and avoids granting direct D1/X credentials.

## Consequences

- Phase 1 ships fixtures and API contracts, not active Cron jobs.
- Hermes may ingest, validate, generate, list and collect metrics, but cannot approve or publish.
- All requests carry a correlation id and idempotency key where applicable.
