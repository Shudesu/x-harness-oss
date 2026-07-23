# Phase 1 Review

## Architecture

The new content domain is isolated in `@x-harness/content-os`; transport, D1 persistence and X Harness integration remain adapters. CUBΣLIC routes do not import the X SDK. The Phase 1 adapter exposes the future publishing interface but makes schedule, publish and delete fail closed. Legacy Worker mutations, Cron automation and legacy MCP tools remain unreachable even when `CUBELIC_SAFE_MODE=false` is supplied.

## Security and privacy

Hermes and human approval use distinct credentials. Approval requires both role authorization and a server-side human key. Input contracts reject extra fields, rights/privacy checks block approval, and the emergency flag is enforced centrally. Every persistence helper requires audit input; state and append-only audit statements commit in one D1 batch, with rollback verified by failure injection. Repository scanning checks high-confidence credentials; deployment secret stores remain an operator responsibility.

The production dependency audit detected PostCSS CVE-2026-41305 through Next.js; the workspace pins the patched `postcss@8.5.10` with a pnpm override and CI re-runs the audit separately during release review.

## Operations

The migration is additive and the default Worker configuration enables safe mode. Approval writes only to an inert inbox. Deployment, rollback, preflight and incident steps are documented. Live X posting, production Cloudflare changes and credential provisioning are deliberately outside this implementation run.

## Deferred decisions

Production GAS/Resolve examples, canonical LP mapping, read-only metrics source, and canonical song/member masters remain explicit non-blocking entries in `docs/Decision-Grill.md`. The production account mapping and topology are resolved. Deterministic generation, evidence-derived seven-axis scoring, atomic audit persistence, two-factor human proof, weighted X text and build-time configuration projection are resolved and enforced in code/CI.

The automated suite covers domain, contract, adapter and fail-closed E2E behavior plus actual Hono routes and D1 semantics under Miniflare. `pnpm validate:production-inputs` validates real structured inputs without printing contents, and `pnpm smoke:staging` verifies deployed draft-only capabilities and legacy-write locks. Production preflight requires staging-smoke attestation for the base Phase 1 runtime and requires production-input validation only when content ingestion is explicitly enabled; current automated tests intentionally make no X calls.

The smoke runner was exercised against the deployed staging Worker after secret rotation and against the fail-closed production Worker. Health and capabilities returned 200, a legacy post mutation returned 423, and an inbox read without human proof returned 403 in both environments. Production additionally verified the database emergency stop and exact operator-only CORS boundary before the maintenance page was removed.
