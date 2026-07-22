# Phase 1 Production Release — 2026-07-23 JST

## Scope

- Release type: fail-closed base Phase 1 infrastructure
- Source commit deployed: `71dd333e221a08c5ba9ce54c58623cd4aa359ecb`
- Operator: authorized local human operator (identity retained in Cloudflare deployment audit)
- Hermes runtime: disabled and uncredentialed
- Production content ingestion: disabled pending real contract inputs

## Cloudflare resources

- Worker: `x-harness-worker-production`
- Worker URL: `https://x-harness-worker-production.yoshihiro-fukiya.workers.dev`
- Worker version: `639d6d2b-3caa-4940-b1fb-0e5a941e38d8`
- D1: `x-harness-production` (`ef612e3b-60bf-425f-9dc3-ad0e11d13798`)
- Pages project: `cubelic-ops-production`
- Pages production deployment: `06e8834b-da81-4721-8dcf-1c902cc29e44`
- Operator origin: `https://ops.cubelic-fan.com`
- Public fan site: unchanged

## Database and rollback

- Pre-release export: `/private/tmp/x-harness-production-pre-release-20260722T235235Z.sql`
- Export SHA-256: `138ebf8c0d0bafa5321580c8ce99fb8af8bceb8790a2fddcd5d0161765ddc3f1`
- Export file mode: `0600`
- Migration: `018-cubelic-content-os.sql`, 55 queries succeeded, 0 data rows written
- D1 bookmark after migration: `00000008-00000004-000050b0-06f8151ea9abb9d184b6af1c890664e4`
- Worker rollback: use Cloudflare Worker version rollback; this is the first persistent production Worker release after the temporary bootstrap Worker was removed.
- Pages rollback target: deployment `f3aef93d-4621-4332-9879-64905c486862` restores the Access-protected maintenance page.

The D1 export contains credentials and production data. Keep it local with mode `0600`; never commit, upload, or paste its contents.

## Safety verification

- `pnpm check`: passed
- `pnpm test:cubelic`: 37 passed
- Standard tests: 180 passed
- D1 integration tests: 7 passed
- Staging Worker smoke after rotating all three staging secrets: passed
- Production preflight: passed with Wrangler OAuth verified through `wrangler whoami`
- Production Worker smoke: passed
- `CUBELIC_SAFE_MODE=true`
- `GLOBAL_PUBLISHING_DISABLED=true`
- D1 `emergency_stop=true`
- Immediate publishing, scheduling, DM, automated engagement and cookie scraping: all false
- Legacy X mutation endpoint: HTTP 423
- Human-only inbox read without approval proof: HTTP 403
- Approved CORS origin: `https://ops.cubelic-fan.com`
- Public fan-site CORS origin: not allowed
- Unauthenticated operator UI request: redirected to Cloudflare Access

## Credentials

- Production `API_KEY` and `HUMAN_APPROVAL_KEY` were generated as separate 64-character values.
- Values are stored in macOS Keychain under `CUBELIC Production API Key` and `CUBELIC Production Human Approval Key`.
- Only secret names are present in Cloudflare and this record; no value was printed or committed.

## Remaining manual gate

Do not disable the D1 emergency stop or enable production content ingestion until the human-approved production masters and source contracts are available. The first run must remain fully manual: one reviewed source, one reviewed draft, one human approval and one inert inbox handoff, with no automated X action.
