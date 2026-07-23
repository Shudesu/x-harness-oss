# CUBΣLIC Phase 1 Operations

## Operating boundary

Phase 1 creates, reviews and measures content. It does not publish, schedule, delete, like, repost, follow, reply or send DMs on X. Approval writes an inert adapter inbox row only. The Phase 1 build keeps this boundary even if `CUBELIC_SAFE_MODE=false` is supplied; keep it `true` as an operational assertion and for preflight visibility.

Production also contains the separately approved DG-024 Phase 3 boundary. It
does not reopen legacy X Harness write routes: only
`POST /api/cubelic/drafts/:id/publish` may perform an immediate text post after
named-human approval, and only reviewed `category:template_id` policies may
enter the CUBΣLIC scheduler. Media delivery, deletion, DMs, replies, likes,
follows and engagement automation remain unavailable. The current production
D1 emergency stop is active, so both Phase 3 publication and scheduling are
disabled until a separate human resume decision.

## Initial setup

1. Copy the variable names from `.env.example` into the deployment secret store. Never commit values.
2. Apply `packages/db/migrations/018-cubelic-content-os.sql`, then `019-cubelic-fail-closed-boundaries.sql`, to a backed-up D1 environment.
3. Set `X_HARNESS_ACCOUNT_ID` to the selected `x_accounts.id`; do not use the public username.
4. Keep `HERMES_RUNTIME_ENABLED=false` in Phase 1 and do not provision Hermes runtime credentials. If a later reviewed release enables it, give Hermes only `HERMES_ACCESS_TOKEN` (the MCP process prefers it over `X_HARNESS_API_KEY`). Give approval UI operators `HUMAN_APPROVAL_KEY`; never expose it to Hermes.
5. Set `CORS_ALLOWED_ORIGINS` to the exact HTTPS approval-UI origin(s), comma-separated; wildcard origins fail closed.
6. Run `corepack pnpm check` before deployment.
7. Run `corepack pnpm preflight:production`; do not deploy while it reports placeholders or missing secret names.

## Daily flow

1. Import the human-approved song/member masters, then ingest an event and its setlist/media metadata through the versioned contracts. Unknown/inactive song ids and title mismatches fail closed.
   Run `pnpm validate:production-inputs` first. Configure `RESOLVE_EXPORT_ALLOWED_ROOTS` with the approved absolute parent directories; test fixtures, known fixture placeholders, nonexistent roots, allowlist escapes and symlink escapes are rejected without printing local paths. The gate also verifies event/song/master links and hashes the actual Resolve media file before accepting the bundle.
2. Validate media and rights evidence. Unknown or expired evidence blocks generation/approval.
3. Generate up to three deterministic drafts. Inspect quality, freshness, privacy and similarity flags.
4. An admin/editor reviews `/cubelic`, edits if needed, then approves with the human approval key.
5. Confirm the audit event and inert inbox row. Copy approved text into X manually only after a final visual check.
6. After manual publication, record the numeric post id with `POST /api/cubelic/metrics/post-mappings` using human approval proof. Metrics collection rejects unmapped post ids, and summaries join the post back to category, member, song, event, fan stage, template, variant and emotion dimensions.

## Emergency controls

- `POST /api/cubelic/admin/emergency-stop` blocks all CUBΣLIC mutation except metrics collection.
- A missing or malformed database emergency-stop flag is treated as stopped. New installations start stopped.
- `POST /api/cubelic/admin/emergency-resume` requires a human approval key and an admin.
- All legacy X and administration routes are unavailable in the Phase 1 Worker, including X-backed GET routes. `GLOBAL_PUBLISHING_DISABLED=true` remains an independent deployment assertion.
- Follow [incident-response.md](incident-response.md) whenever a boundary or rights concern is discovered.
- An X timeout or ambiguous response must remain `publishing`; never retry it
  automatically. Follow “Publication outcome unknown” in
  [incident-response.md](incident-response.md). Until DG-026 is resolved,
  reconciliation is an exceptional documented operation rather than a normal
  UI/API action.

## Rollback

Set the emergency stop first, then roll the Worker/UI back to the last known version. The migration is additive; do not drop tables during an incident. Preserve append-only audit rows and export relevant D1 records before any repair.

Production GAS payload shape, Resolve path and other deferred integration inputs remain tracked in [Decision-Grill.md](Decision-Grill.md). The production topology and X Harness account mapping are resolved.
