# ADR-005 — Co-locate Phase 1 API and state on Cloudflare

- Status: Accepted provisionally
- Date: 2026-07-21

## Decision

Run Planner API routes inside the existing Hono Worker, keep state in the existing D1 database, and deploy the approval UI through the existing Next.js path. Media bytes remain outside D1; only metadata, hash and evidence references are stored.

## Rationale

This provides one authenticated API boundary and one transactional store. Cloudflare account topology is not yet supplied, so no production deployment is performed.

## Consequences

- `CUBELIC_SAFE_MODE=true` is required in Worker configuration.
- Production CORS and domains remain a deployment decision.
- Local and CI safety tests use pure domain/adapter fixtures and never require cloud credentials.
