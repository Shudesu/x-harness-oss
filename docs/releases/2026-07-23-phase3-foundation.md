# Phase 3 publication foundation release — 2026-07-23

## Scope

DG-024 implementation was released as a default-disabled foundation. This
release installs the audited publication substrate, guarded Worker routes,
Cron trigger, and operator UI without enabling X publication or scheduling.

## Source

- Fork: `Y-Fukiya/x-harness-oss`
- Branch: `codex/production-operation`
- Commit: `73f9737a81ec04103d2ba7e94e5a1b3baba8ebd8`
- Reviews: specification and operations reviews both reported zero release-blocking findings

## Verification

- `pnpm test`: 26 files, 221 tests passed
- `pnpm test:cubelic`: 9 files, 50 tests passed
- `pnpm test:d1`: 2 files, 13 tests passed
- `pnpm test:contracts`: 1 file, 12 tests passed
- `pnpm typecheck`: passed
- `pnpm build`: passed
- boundary, configuration-sync, secret, and diff checks: passed
- staging smoke after deployment: passed

## D1

- Staging restore bookmark before migration:
  `00000006-00000000-000050b1-843c02714608de6ee89f7aadddea75b1`
- Staging bookmark after migration 020:
  `00000006-00000007-000050b1-d07fee6f21e82575b3a2db5877ae4660`
- Production restore bookmark before migration:
  `00000011-00000000-000050b1-dea9abaaf63ae388078924500115de2d`
- Production bookmark after migration 020:
  `00000012-0000000a-000050b1-2214fc4f7be473027e584377da806c70`

Migration 020 executed 11 queries in each environment and completed
successfully.

## Deployments

- Staging Worker version:
  `27df3d6b-709f-41b0-a182-b8368112b61a`
- Production Worker version:
  `609137a7-eba7-4869-bc26-1fd755387c87`
- Production Pages deployment:
  `https://69b45bd1.cubelic-ops-production.pages.dev`
- Protected operator origin:
  `https://ops.cubelic-fan.com`

The custom operator origin returned the expected Cloudflare Access redirect
for unauthenticated requests.

## Post-release safety state

Production verification returned:

- `CUBELIC_SAFE_MODE=true`
- `GLOBAL_PUBLISHING_DISABLED=true`
- D1 emergency stop active
- `CUBELIC_PHASE3_ENABLED=false`
- `PHASE3_RELEASE_APPROVED=false`
- `STAGING_PHASE3_SMOKE_VERIFIED=false`
- empty Phase 3 scheduling allowlist
- immediate publishing disabled
- scheduling disabled

Cron is installed at five-minute intervals, but its runtime gate returns
without claiming or delivering work in this state.

## Remaining enablement gate

This foundation release is not the Phase 3 go-live. Enabling X delivery still
requires a named staff credential, reviewed category/template policy pairs,
the Phase 3 staging delivery exercise, explicit staging-smoke attestation,
release approval, and a human-supervised first production text post. Media
delivery remains blocked until its R2-to-X upload and reconciliation boundary
is separately approved.
