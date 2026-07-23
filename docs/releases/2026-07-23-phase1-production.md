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
