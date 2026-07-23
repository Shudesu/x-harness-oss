# Data Dictionary

| Entity | Purpose | Important fields |
| --- | --- | --- |
| Event | Canonical live/event record | `event_id`, title, venue, start/end, source version |
| Setlist | Ordered songs for an event | event id, position, song id/title, source payload hash |
| Song master | Human-approved canonical song catalog | stable song id, canonical title, aliases, active flag, source version |
| Member master | Human-approved canonical member catalog | stable member id, display name, aliases, active flag, source version |
| Media asset | Explicitly supplied Resolve/export metadata | asset id, content hash, duration, dimensions, allowlisted source |
| Rights evidence | Proof and permitted usage window | evidence id, asset id, owner/license, valid from/to, status |
| Content item | Planning unit before generation | event id, category, canonical destination, context |
| Draft post | Reviewable X copy | state, text, quality breakdown, flags, version, idempotency key |
| X draft inbox | Inert human handoff | draft id, account id, text, approved actor/time; no scheduler fields |
| Metrics | Time-series measurements | post id, observed time, platform and qualified-conversion counts |
| Incident | Operational safety record | severity, status, summary, correlation id |
| Audit log | Append-only evidence trail | actor, action, entity, before/after JSON, correlation id, timestamp |

The normative machine contracts are in `packages/schemas/cubelic`. Database names and constraints are defined by ordered migrations in `packages/db/migrations/`, beginning with `018-cubelic-content-os.sql` and its Phase 1 hardening migration `019-cubelic-fail-closed-boundaries.sql`.
