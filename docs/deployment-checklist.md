# Phase 1 Deployment Checklist

## Before staging

- Resolve every production-blocking input in `docs/Decision-Grill.md` or record its approved staging substitute.
- Create separate staging D1, Worker and Web resources.
- Keep `cubelic-fan.com` on its existing fan-site Pages project. Deploy the operator UI as a separate Pages project at `ops.cubelic-fan.com`; never deploy `apps/web/out` to the fan-site project.
- Protect `ops.cubelic-fan.com` with Cloudflare Access before granting operator access.
- Replace the Worker URL, D1 database id and X Harness account-row placeholder.
- Provision distinct `API_KEY` and `HUMAN_APPROVAL_KEY` secrets. Keep `HERMES_RUNTIME_ENABLED=false` and do not provision `HERMES_ACCESS_TOKEN` in Phase 1; if a later release enables the Hermes runtime, its token becomes required and must be distinct.
- For CI, provision a least-privilege `CLOUDFLARE_API_TOKEN`. For a manual release using Wrangler's encrypted OAuth store, run `wrangler whoami` for the intended account and only then set `CLOUDFLARE_AUTH_VERIFIED=true` in the release shell.
- Keep `CUBELIC_SAFE_MODE=true`; give Hermes neither the API admin key nor the human approval key.
- Configure an allowlisted production CORS origin before exposing the approval UI.
- Production CORS must be exactly `https://ops.cubelic-fan.com`; the public fan-site origin is not an operator origin.
- Keep `PRODUCTION_CONTENT_INGEST_ENABLED=false` for the base Phase 1 infrastructure release. Import the human-approved `cubelic.song-master.v1` and `cubelic.member-master.v1` contracts before any production setlist.
- Run `pnpm preflight:production`; it reports names only and never prints secret values.
- Set `PRODUCTION_INPUTS_VALIDATED=true` only after contract validation succeeds. Set `PRODUCTION_LP_MAPPING_VALIDATED=true` only after a human approves the authoritative event-to-LP route and confirms the LP update state. Both attestations are required before enabling `PRODUCTION_CONTENT_INGEST_ENABLED=true`. Set `STAGING_SMOKE_VERIFIED=true` only after the staging smoke succeeds.

## Staging validation

1. Run `pnpm check`, apply `018-cubelic-content-os.sql`,
   `019-cubelic-fail-closed-boundaries.sql`,
   `020-cubelic-phase3-publication.sql`, then
   `021-cubelic-publication-reconciliation.sql` to staging D1, then run
   `STAGING_WORKER_URL=... STAGING_API_KEY=... pnpm smoke:staging` from an
   approved secret-bearing shell. Smoke must observe
   `emergencyStopValid: true`; a missing or malformed D1 stop row is a failed
   deployment even though runtime mutations still fail closed.
2. Import redacted master fixtures, then ingest a redacted real GAS setlist and confirm exactly one Content Item plus no more than three drafts; an unknown id/title must be rejected.
3. Ingest a redacted real Resolve sidecar and verify duplicate hash, rights and privacy failures.
4. Confirm Hermes cannot edit, approve, reject, stop/resume, schedule or publish.
5. Confirm an editor/admin without `X-Human-Approval-Key` cannot approve.
6. Approve with a named human and confirm exactly one inert inbox row and no X post/schedule id.
7. Activate both database emergency stop and `GLOBAL_PUBLISHING_DISABLED=true`; verify all non-metrics writes and every legacy route (including X-backed GET requests) fail.
8. Rotate all staging secrets after the exercise.

## Production release

- Build the operator UI with `NEXT_PUBLIC_MAINTENANCE_MODE=true` until the production Worker and secrets pass smoke verification; only then rebuild with the flag set to `false`.
- Back up D1, apply the additive migration, deploy Worker, then deploy Web.
- Verify the operator Pages project and custom-domain target are distinct from the existing `cubelic-fan` project before deploying Web.
- Verify Cloudflare Access denies an unauthenticated request to `ops.cubelic-fan.com` before sharing the URL.
- Check `/api/capabilities` and `/api/cubelic/admin/status` before operator access.
- Run `pnpm verify:production-safety:keychain` and require a valid active D1
  stop, disabled publishing/scheduling, and no active operation window.
- Keep the first production run manual: one source, one reviewed draft, one inert handoff, no automated X action.
- Before that run, validate the six-contract bundle and event-specific LP attestation, then run `pnpm operate:production:check` with both emergency stops active. Open a separately reviewed operation window (`GLOBAL_PUBLISHING_DISABLED=false`), set `PRODUCTION_OPERATION_WINDOW_OPEN=true` and `PRODUCTION_OPERATION_CONFIRMED` to the exact approved event id, then run `pnpm operate:production:first-run`. The server binds writes to that event for at most 30 minutes; ingest failure and the first successful inert handoff re-engage the D1 stop. Restore the environment stop immediately after handoff.
- Record release commit, operator, migration result and rollback point in the audit/release record.
- If any boundary differs from staging, activate emergency stop and follow `docs/incident-response.md`.

## Phase 3 publication release

Phase 3 is default-disabled. Do not combine its first enablement with unrelated migrations or UI changes.

1. Apply migrations `020-cubelic-phase3-publication.sql` and
   `021-cubelic-publication-reconciliation.sql` to staging and keep both stops
   active.
2. Configure `CUBELIC_PHASE3_DELIVERY_MODE=staging_fake` only on the dedicated staging Worker, then configure exact reviewed `category:template_id` pairs in `CUBELIC_PHASE3_SCHEDULE_POLICIES`. Only `event_notice`, `event_reminder`, and `youtube_notice` may be allowlisted.
3. Set `CUBELIC_PHASE3_ENABLED=true` and `GLOBAL_PUBLISHING_DISABLED=false` in staging, then use the human approval key to resume the D1 stop.
4. Create a named admin/editor staff credential and sign in with that staff API key. The shared environment `API_KEY` may inspect the system but cannot attest manual production input, approve a Phase 3 draft, or publish immediately.
5. Verify an unapproved draft, mismatched operator, missing rights/privacy/link proof, non-allowlisted policy pair, past schedule time, daily/weekly limit, and minimum interval are rejected.
6. Publish one text-only staging fixture through the fake/staging X destination and verify one `publication.started` plus one `publication.completed` audit. A request with CUBΣLIC media must fail with `media_delivery_not_configured` until the media-delivery boundary is separately approved.
7. Schedule one allowlisted fixture through Hermes and verify Cron claims it once. Stop the system before another due run and verify no X call occurs. Simulate an X timeout and verify the job remains `publishing` with `publication.outcome_unknown`, never an automatic retry.
8. Set `STAGING_PHASE3_SMOKE_VERIFIED=true` only after the preceding checks pass.
9. Run production preflight with `CUBELIC_PHASE3_ENABLED=true`, `CUBELIC_PHASE3_DELIVERY_MODE=x`, `GLOBAL_PUBLISHING_DISABLED=false`, `PHASE3_RELEASE_APPROVED=true`, the reviewed policies, and `STAGING_PHASE3_SMOKE_VERIFIED=true`. Production must reject `staging_fake`.
10. Back up D1, apply migrations 020 and 021, deploy Worker, verify Cron and
    `/api/cubelic/admin/status`, then deploy the operator UI.
11. Resume the D1 stop only when a named operator is present. Publish one human-approved text draft, verify the returned X post manually, and keep the emergency-stop control visible throughout.
