# Phase 1 Deployment Checklist

## Before staging

- Resolve every production-blocking input in `docs/Decision-Grill.md` or record its approved staging substitute.
- Create separate staging D1, Worker and Web resources.
- Keep `cubelic-fan.com` on its existing fan-site Pages project. Deploy the operator UI as a separate Pages project at `ops.cubelic-fan.com`; never deploy `apps/web/out` to the fan-site project.
- Protect `ops.cubelic-fan.com` with Cloudflare Access before granting operator access.
- Replace the Worker URL, D1 database id and X Harness account-row placeholder.
- Provision distinct `API_KEY` and `HUMAN_APPROVAL_KEY` secrets. Keep `HERMES_RUNTIME_ENABLED=false` and do not provision `HERMES_ACCESS_TOKEN` in Phase 1; if a later release enables the Hermes runtime, its token becomes required and must be distinct.
- Keep `CUBELIC_SAFE_MODE=true`; give Hermes neither the API admin key nor the human approval key.
- Configure an allowlisted production CORS origin before exposing the approval UI.
- Production CORS must be exactly `https://ops.cubelic-fan.com`; the public fan-site origin is not an operator origin.
- Keep `PRODUCTION_CONTENT_INGEST_ENABLED=false` for the base Phase 1 infrastructure release. Import the human-approved `cubelic.song-master.v1` and `cubelic.member-master.v1` contracts before any production setlist.
- Run `pnpm preflight:production`; it reports names only and never prints secret values.
- Set `PRODUCTION_INPUTS_VALIDATED=true` only after contract validation succeeds and before enabling `PRODUCTION_CONTENT_INGEST_ENABLED=true`. Set `STAGING_SMOKE_VERIFIED=true` only after the staging smoke succeeds.

## Staging validation

1. Run `pnpm check`, apply `018-cubelic-content-os.sql` to staging D1, then run `STAGING_WORKER_URL=... STAGING_API_KEY=... pnpm smoke:staging` from an approved secret-bearing shell.
2. Import redacted master fixtures, then ingest a redacted real GAS setlist and confirm exactly one Content Item plus no more than three drafts; an unknown id/title must be rejected.
3. Ingest a redacted real Resolve sidecar and verify duplicate hash, rights and privacy failures.
4. Confirm Hermes cannot edit, approve, reject, stop/resume, schedule or publish.
5. Confirm an editor/admin without `X-Human-Approval-Key` cannot approve.
6. Approve with a named human and confirm exactly one inert inbox row and no X post/schedule id.
7. Activate both database emergency stop and `GLOBAL_PUBLISHING_DISABLED=true`; verify all non-metrics writes and legacy X writes fail.
8. Rotate all staging secrets after the exercise.

## Production release

- Build the operator UI with `NEXT_PUBLIC_MAINTENANCE_MODE=true` until the production Worker and secrets pass smoke verification; only then rebuild with the flag set to `false`.
- Back up D1, apply the additive migration, deploy Worker, then deploy Web.
- Verify the operator Pages project and custom-domain target are distinct from the existing `cubelic-fan` project before deploying Web.
- Verify Cloudflare Access denies an unauthenticated request to `ops.cubelic-fan.com` before sharing the URL.
- Check `/api/capabilities` and `/api/cubelic/admin/status` before operator access.
- Keep the first production run manual: one source, one reviewed draft, one inert handoff, no automated X action.
- Record release commit, operator, migration result and rollback point in the audit/release record.
- If any boundary differs from staging, activate emergency stop and follow `docs/incident-response.md`.
