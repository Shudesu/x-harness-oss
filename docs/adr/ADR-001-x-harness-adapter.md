# ADR-001 — Wrap X Harness with a publishing adapter

- Status: Accepted for Phase 1
- Date: 2026-07-21

## Decision

CUBΣLIC application code depends only on `XPublishingAdapter`. The Phase 1 implementation writes approved drafts to the canonical adapter-owned inert D1 inbox defined by `cubelic.x-harness-inert-draft.v1`. `schedulePost`, `publishPost`, and `deletePost` always throw typed policy errors.

## Rationale

Upstream X Harness routes can publish immediately or create executable schedules. Keeping those details behind one adapter makes the human-approval and no-publish boundary testable and replaceable.

## Consequences

- No CUBΣLIC route imports `XClient`.
- Adapter contract tests prove that approval never calls X.
- The versioned JSON Schema, typed read model, unique draft/idempotency keys and human-only inspection endpoint form the Phase 1 X Harness draft subsystem.
- A future native draft API may replace the inbox behind a new ADR and migrate by `draft_id`/`idempotency_key` without changing Planner routes.
- Draft idempotency follows the Phase 1 media-content contract: account, content id, template version, actual media SHA-256 (or `none`) and variant are hashed. Variant is an intentional extension so the maximum three review candidates remain distinct while retries of each candidate converge.
