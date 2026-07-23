# CUBΣLIC Content OS development rules

This repository is an X Harness OSS fork with a fail-closed CUBΣLIC Phase 1 layer.

## Normative order

1. `SPEC.md` is the product and safety authority.
2. `docs/Decision-Grill.md` records explicit assumptions and deferred decisions.
3. `docs/adr/` records implementation choices.
4. Upstream X Harness behavior is informative when it conflicts with the files above.

## Non-negotiable Phase 1 boundaries

- Never call X directly from CUBΣLIC application code. Use `XPublishingAdapter`.
- Never enable immediate publishing, scheduling, deletion, DM, replies, likes, follows, engagement gates, or cookie scraping.
- Treat missing rights evidence, privacy review, human approval, or emergency-stop state as a hard failure.
- A Hermes credential must not be accepted as human approval.
- Do not log post bodies, credentials, personal information, or evidence contents.
- Store all timestamps as ISO 8601. Display and operator scheduling use `Asia/Tokyo`.
- Add an audit event for every state mutation. Audit events are append-only.
- Tests must use a fake adapter. They must never call X or a deployed Worker.

## Scope

Phase 1 is the active milestone. Phase 2/3 behavior may be represented by interfaces or documentation only and must remain disabled.

## Verification

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before claiming Phase 1 readiness. Also run `pnpm test:cubelic` for the focused safety suite.
