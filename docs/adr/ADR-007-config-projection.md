# ADR-007 — Validate a typed projection of strategy YAML at build time

- Status: Accepted for Phase 1
- Date: 2026-07-21

## Decision

Project the safety-critical account, publishing and content-limit scalars from `config/*.yaml` into `packages/content-os/src/policy.generated.ts`. CI runs `pnpm check:config` and fails if the YAML, typed policy or D1 account constraint diverges.

## Rationale

Cloudflare Workers cannot safely treat repository YAML as mutable runtime policy, while duplicated unchecked constants could drift. A checked build-time projection keeps the reviewed YAML authoritative without adding a production configuration mutation surface.

## Consequences

- Domain generation, hashtag, duplicate and approval thresholds consume the typed projection.
- All Phase 1 publishing switches must remain false.
- Config changes require a matching reviewed projection and green CI.
- A versioned D1 configuration promotion workflow may replace this in a later phase.
