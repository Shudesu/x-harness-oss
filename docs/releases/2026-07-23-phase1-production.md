# Phase 1 Production Release — 2026-07-23 JST

## Scope

- Release type: fail-closed base Phase 1 infrastructure
- Source commit deployed: `4def0b91d863b29a0cd8c05f192e5799c4c84cc0`
- Operator: authorized local human operator (identity retained in Cloudflare deployment audit)
- Hermes runtime: disabled and uncredentialed
- Production content ingestion: disabled pending real contract inputs

## Cloudflare resources

- Worker: `x-harness-worker-production`
- Worker URL: `https://x-harness-worker-production.yoshihiro-fukiya.workers.dev`
- Worker version: `33b668d5-2bfc-472d-bb6c-300add6441c2`
- D1: `x-harness-production` (`ef612e3b-60bf-425f-9dc3-ad0e11d13798`)
- Pages project: `cubelic-ops-production`
- Pages production deployment: `0fd3a41a-203c-497d-a418-20af96dd673b` (Phase 1 route-boundary hardening, source `4def0b9`)
- Operator origin: `https://ops.cubelic-fan.com`
- Public fan site: unchanged

## Database and rollback

- Pre-release export: `/private/tmp/x-harness-production-pre-release-20260722T235235Z.sql`
- Export SHA-256: `138ebf8c0d0bafa5321580c8ce99fb8af8bceb8790a2fddcd5d0161765ddc3f1`
- Export file mode: `0600`
- Migration: `018-cubelic-content-os.sql`, 55 queries succeeded, 0 data rows written
- Pre-hardening export: `/private/tmp/x-harness-production-pre-hardening-20260723T002800Z.sql`
- Pre-hardening export SHA-256: `138ebf8c0d0bafa5321580c8ce99fb8af8bceb8790a2fddcd5d0161765ddc3f1`
- Hardening migration: `019-cubelic-fail-closed-boundaries.sql`, 34 queries succeeded
- D1 bookmark after migration 019: `0000000a-00000008-000050b1-fc5a0e978ed97c34f04b8b6d46750477`
- Worker rollback: use Cloudflare Worker version rollback; this is the first persistent production Worker release after the temporary bootstrap Worker was removed.
- Pages rollback target: deployment `f3aef93d-4621-4332-9879-64905c486862` restores the Access-protected maintenance page.

The D1 export contains credentials and production data. Keep it local with mode `0600`; never commit, upload, or paste its contents.

## Safety verification

- `pnpm check`: passed
- `pnpm test:cubelic`: 38 passed
- Production dependency audit: no known vulnerabilities
- Operator UI framework: Next.js `15.5.21`
- GitHub Actions `CUBΣLIC CI`: passed for security commit `2cf191c`
- Standard tests: 181 passed
- D1 integration tests: 7 passed
- Staging Worker smoke after rotating all three staging secrets: passed
- Production preflight: passed with Wrangler OAuth verified through `wrangler whoami`
- Production Worker smoke: passed
- `CUBELIC_SAFE_MODE=true`
- `GLOBAL_PUBLISHING_DISABLED=true`
- D1 `emergency_stop=true`
- Immediate publishing, scheduling, DM, automated engagement and cookie scraping: all false
- All legacy routes are blocked in Phase 1; both a mutation endpoint and an X-backed GET endpoint returned HTTP 423
- All 15 D1 emergency-stop triggers use fail-closed semantics; missing and malformed flags are covered by integration tests
- Human-only inbox read without approval proof: HTTP 403
- Approved CORS origin: `https://ops.cubelic-fan.com`
- Public fan-site CORS origin: not allowed
- Unauthenticated operator UI request: redirected to Cloudflare Access
- Direct Pages deployment URL: also redirected to Cloudflare Access (no bypass)

## Credentials

- Production `API_KEY` and `HUMAN_APPROVAL_KEY` were generated as separate 64-character values.
- Values are stored in macOS Keychain under `CUBELIC Production API Key` and `CUBELIC Production Human Approval Key`.
- Only secret names are present in Cloudflare and this record; no value was printed or committed.

## Remaining manual gate

Do not disable the D1 emergency stop or enable production content ingestion until the human-approved production masters and source contracts are available. The first run must remain fully manual: one reviewed source, one reviewed draft, one human approval and one inert inbox handoff, with no automated X action.

## Post-release staging hardening

- Source commit: `3fe0bba8439f79cc21f8f0090b577c813bba68bf`
- Fork CI run `29973397872`: passed
- Staging Worker code deployment: `f1b31de1-d2d9-4bd3-8210-d86d129377bf`
- Current staging binding version after secret rotation: `a2d49199-e674-4800-b4c9-e6d938326ef3`
- `CUBELIC_SAFE_MODE=true` and `GLOBAL_PUBLISHING_DISABLED=true` are active in staging.
- The obsolete staging `HERMES_ACCESS_TOKEN` was deleted; only the API and human-approval secret names remain.
- The staging API key was rotated and stored in macOS Keychain without printing or committing its value.
- The audited human emergency-stop endpoint restored the staging D1 flag to `true`.
- Staging smoke passed after all changes. The boundary checker now rejects either environment lock unless every configured environment sets it to `true`.

## Production operation-readiness update

- Source commit deployed: `e8e25bfa2462acd0929f14fe95721c97091abfd1`
- Release tag: `cubelic-phase1-ops1`
- Fork main: `Y-Fukiya/x-harness-oss@e8e25bf`
- Worker version: `778334f2-62b2-41ea-9a06-e060fe2663ad`
- Pages deployment: `e530337c-699a-4073-8054-6a8d7212dde1`
- Pages deployment URL: `https://e530337c.cubelic-ops-production.pages.dev`
- Database migration: none; operation-window state uses the existing audited `cubelic_system_flags` store.
- Standard tests: 206 passed.
- D1 integration tests: 11 passed.
- Focused CUBΣLIC tests: 38 passed.
- JSON Schema audit: 18 schemas, 0 reported issues.
- Independent standards review: 0 actionable findings.
- Independent specification review: 0 actionable findings.

The production input bundle now requires a complete LP event contract and an event-specific LP mapping approval bound to the GAS `event_id` and `lp_url`. The first-run operator command reads both production credentials from macOS Keychain, refuses stale attestations, and never approves or publishes a draft.

Production mutation remains closed by both controls until real inputs are supplied. A reviewed run temporarily sets the environment stop to exact `false`, then opens a human-authenticated server window bound to one event for at most 30 minutes. Missing, malformed, expired or cross-event state fails closed. Ingestion failure re-engages and verifies the D1 stop. The first successful inert handoff atomically updates the draft, deletes the operation window and re-engages the D1 stop in one batch.

Post-deploy verification:

- `https://ops.cubelic-fan.com/login`: Cloudflare Access redirect (`302`)
- unauthenticated `/api/capabilities`: `401`
- authenticated status: `safeMode=true`, `environmentStop=true`, `emergencyStop=true`, `operationWindow=null`, publishing and scheduling both false
- operation-window open attempt while the environment stop was active: `423 environment_stop_active`
- production secrets: `API_KEY` and `HUMAN_APPROVAL_KEY` only; no Hermes credential
- D1 flags: exact `emergency_stop=true`; no operation-window keys

No production content was imported because the six human-approved production contracts are not yet present in the ignored `production-inputs/` handoff directory.
