# ADR-002 — Use Cloudflare D1 for Phase 1 state

- Status: Accepted for Phase 1
- Date: 2026-07-21

## Decision

Store events, media, rights evidence, content, drafts, adapter inbox rows, incidents, metrics, flags and append-only audits in the existing D1 database.

## Rationale

The upstream deployment already requires D1. A second store would add distributed transactions at the approval boundary. SQLite constraints plus idempotent inserts make approval retries recoverable in Phase 1.

## Consequences

- Migrations `018-cubelic-content-os.sql` and `019-cubelic-fail-closed-boundaries.sql` are mandatory and applied in order.
- New, missing or malformed emergency-stop state is treated as stopped at both application and database-trigger layers.
- JSON columns use canonical JSON strings and are validated at the API boundary.
- Audit update/delete is blocked by database triggers.
