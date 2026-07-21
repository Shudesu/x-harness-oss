# Phase 1 Deployment Checklist

## Before staging

- Resolve every production-blocking input in `docs/Decision-Grill.md` or record its approved staging substitute.
- Create separate staging D1, Worker and Web resources.
- Replace the Worker URL, D1 database id and X Harness account-row placeholder.
- Provision `API_KEY`, `HERMES_ACCESS_TOKEN` and `HUMAN_APPROVAL_KEY` as distinct secrets.
- Keep `CUBELIC_SAFE_MODE=true`; give Hermes neither the API admin key nor the human approval key.
- Configure an allowlisted production CORS origin before exposing the approval UI.
- Import the human-approved `cubelic.song-master.v1` and `cubelic.member-master.v1` contracts before any production setlist.
- Run `pnpm preflight:production`; it reports names only and never prints secret values.
- Set `PRODUCTION_INPUTS_VALIDATED=true` only in the release shell after contract validation succeeds, and `STAGING_SMOKE_VERIFIED=true` only after the staging smoke succeeds.

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

- Back up D1, apply the additive migration, deploy Worker, then deploy Web.
- Check `/api/capabilities` and `/api/cubelic/admin/status` before operator access.
- Keep the first production run manual: one source, one reviewed draft, one inert handoff, no automated X action.
- Record release commit, operator, migration result and rollback point in the audit/release record.
- If any boundary differs from staging, activate emergency stop and follow `docs/incident-response.md`.
