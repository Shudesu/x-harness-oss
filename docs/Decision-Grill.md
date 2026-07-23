# Decision Grill

## DG-001 — Native X Harness draft contract

- Status: RESOLVED
- Evidence: `SPEC.md` §7.2, §16, §23.2, §26; upstream `apps/worker/src/routes/posts.ts`; upstream `apps/worker/src/routes/growth.ts`
- Conflict/gap: X Harness has immediate and scheduled posts, while its growth approval moves a draft directly into the executable schedule; it has no inert native draft.
- Impact: `XPublishingAdapter.createDraft`, approval E2E, deployment boundary.
- Safest current behavior: Store an adapter-owned inert inbox row that has no scheduler/publisher path.
- Needed answer: Should a later X Harness upgrade introduce a native inert draft, should the adapter migrate existing inbox rows or retain its own store?
- Resolution: The adapter-owned inbox is the canonical Phase 1 X Harness draft subsystem. Its `cubelic.x-harness-inert-draft.v1` schema, typed read model, unique idempotency contract, human-only inspection route and fail-closed adapter are tested. Any native upstream replacement requires a new ADR and migration keyed by `draft_id`/`idempotency_key`.

## DG-002 — GAS setlist JSON contract

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §4.2, §22.1, §24.2, §28 Task 1; no GAS sample exists in the workspace.
- Conflict/gap: The specification requires a fixed GAS contract but does not define its payload shape.
- Impact: Setlist ingestion field mapping and production compatibility.
- Safest current behavior: Accept only the documented `cubelic.gas-setlist.v1` fixture contract and reject unknown versions.
- Needed answer: Provide one redacted production GAS payload and the canonical song-master identifiers.
- Resolution: Pending.

## DG-003 — Resolve metadata and watched path

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §7.2, §22.2, §24.2, ADR-006 requirement; no sidecar sample or Resolve path exists in the workspace.
- Conflict/gap: File access and metadata fields cannot be bound to a real export contract.
- Impact: Automatic media discovery and exact ffprobe/sidecar mapping.
- Safest current behavior: Phase 1 accepts explicit media metadata through the validation API, hashes supplied bytes/identifiers, and never scans arbitrary paths.
- Needed answer: Provide a redacted Resolve sidecar plus the allowlisted export root.
- Resolution: Pending.

## DG-004 — Post generation provider

- Status: RESOLVED
- Evidence: `SPEC.md` §7.2, §11, §22.3; no model, provider, prompt authority or retention policy is specified.
- Conflict/gap: “Hermes generates” does not define the Phase 1 generation runtime.
- Impact: Reproducibility, privacy, tone and cost.
- Safest current behavior: Use deterministic, versioned Japanese templates that produce at most three variants and expose all review flags.
- Needed answer: Which model/provider and data-retention policy may be used when generative variants are enabled?
- Resolution: Phase 1 deliberately uses versioned deterministic Japanese templates and persists template/version/variant. A generative provider requires a new reviewed ADR and retention decision in a later phase.

## DG-005 — Proof of human approval

- Status: RESOLVED
- Evidence: `SPEC.md` P-01, §16.2, §21.2; upstream `apps/worker/src/middleware/auth.ts` grants admin to a shared environment API key.
- Conflict/gap: Existing roles do not prove that an approval request came from a human rather than Hermes.
- Impact: Approval endpoint authorization and the primary safety guarantee.
- Safest current behavior: Require both an admin/editor session and a distinct `X-Human-Approval-Key` matching a server-only secret; Hermes never receives that secret.
- Needed answer: Should production replace the second secret with SSO/WebAuthn and named operator identities?
- Resolution: Phase 1 requires an authenticated admin/editor plus a distinct server-side `X-Human-Approval-Key`; Hermes receives neither credential. Named SSO/WebAuthn remains a production-hardening option.

## DG-006 — X account database identifier

- Status: RESOLVED
- Evidence: `SPEC.md` §27 uses logical id `tubelic_cube`; upstream X Harness stores a generated `x_accounts.id` plus username.
- Conflict/gap: The logical account id is not guaranteed to equal the X Harness row id.
- Impact: Adapter handoff and account isolation.
- Safest current behavior: Resolve through the explicit `X_HARNESS_ACCOUNT_ID` deployment setting and reject a mismatch.
- Needed answer: Provide the production X Harness row id after account setup.
- Resolution: Production account `tubelic_cube` is mapped to X Harness row id `89f9bfc0-428c-480b-9cb3-9ba1698c30da`. The production Worker configuration binds that exact id and preflight rejects the former setup placeholder.

## DG-007 — X text length semantics

- Status: RESOLVED
- Evidence: `SPEC.md` §24.1 requires a character-length test but does not specify weighted URL/CJK counting.
- Conflict/gap: A plain Unicode code-point count is not X's complete weighted-text algorithm.
- Impact: False accept/reject at the text boundary.
- Safest current behavior: Use the official `twitter-text` parser and keep templates comfortably below its weighted limit.
- Needed answer: Confirm whether to add the official weighted-text library once the final posting surface is enabled.
- Resolution: Phase 1 validates every generated, edited and approved body with `twitter-text@3.1.0` `parseTweet`; Japanese/CJK and URL weights are covered by tests.

## DG-008 — Quality-score inputs

- Status: RESOLVED
- Evidence: `SPEC.md` §13 defines axes and thresholds but not an algorithm or source-of-truth values.
- Conflict/gap: The same content could receive different scores without a scoring rubric.
- Impact: Approval eligibility and test repeatability.
- Safest current behavior: Use a deterministic rubric with bounded axis inputs and persist the breakdown; scores below 80 cannot be approved.
- Needed answer: Approve or revise the Phase 1 rubric after reviewing real drafts.
- Resolution: Phase 1 derives all seven axes from stored event, setlist, content, variant and inspected-media facts. Freshness follows the normative time buckets, media appeal follows the inspected quality score, and every breakdown is persisted. Calibration against production drafts remains a later policy revision, not an unscored default.

## DG-009 — Public LP/GAS event identifier mapping

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §14; the public archive exposes detail routes such as `/setlists/2026-07-14/afterimage-trace/`, but `cubelic-fan.com` labels the archive unofficial and exposes no supplied stable JSON/GAS endpoint.
- Conflict/gap: The visible date/slug route does not define a canonical `event_id` to slug mapping, and it is not authoritative enough to infer one.
- Impact: UTM destination correctness.
- Safest current behavior: Require an explicit HTTPS `base_url` on each content item and reject hand-entered tracked URLs.
- Needed answer: Confirm whether `/setlists/<YYYY-MM-DD>/<slug>/` is the canonical production route and provide the authoritative `event_id` to slug mapping or JSON endpoint.
- Resolution: Pending. `PRODUCTION_LP_MAPPING_VALIDATED` defaults to false and production preflight blocks content ingestion until a human separately attests that the authoritative event-to-LP mapping and LP update state were validated.

## DG-010 — Phase 1 deployment topology

- Status: RESOLVED
- Evidence: `SPEC.md` §7.1, §8, ADR-005 requirement; no Cloudflare account topology or environment list was supplied.
- Conflict/gap: Worker/D1/UI may be one deployment or separate trust zones.
- Impact: CORS, secret placement, rollback and production runbook details.
- Safest current behavior: Keep Planner routes in the existing Worker and approval UI in the existing Next app, with one D1 and no public unauthenticated mutation.
- Needed answer: Confirm staging/production domains and whether the approval UI must be private-network-only.
- Resolution: Keep the existing public fan site at `https://cubelic-fan.com` unchanged. Deploy the operator UI to the separate `https://ops.cubelic-fan.com` origin and protect it with Cloudflare Access. Production Worker CORS permits only that operator origin. Public event/setlist output may be integrated into the fan site later through an explicitly reviewed read-only surface; the X Harness operator application must never replace the fan-site root deployment.

## DG-011 — Runtime projection of strategy YAML

- Status: RESOLVED
- Evidence: `SPEC.md` P-02, §9, §27; `config/*.yaml`; Cloudflare Worker bundle has no agreed config-loader/deployment pipeline.
- Conflict/gap: Phase 1 rules mirror the safety-critical YAML values in typed code, but the YAML is not dynamically loaded. Editing YAML alone therefore does not change runtime behavior.
- Impact: Content mix, thresholds, account identity and later policy changes could drift from executable rules.
- Safest current behavior: Keep conservative constants in the domain module and require tests/code review for changes; publishing remains disabled independently.
- Needed answer: Choose a build-time validated config compiler or a versioned D1 config promotion flow with rollback.
- Resolution: Phase 1 uses a build-time checked typed projection in `policy.generated.ts`; `pnpm check:config` fails on YAML/code/D1 drift. A mutable D1 promotion flow remains a later-phase option.

## DG-012 — Production metrics source

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §6, §15, §22.4, §23.2; no production X metrics entitlement or analytics credential was supplied.
- Conflict/gap: The Phase 1 adapter preserves the complete metrics shape but currently records unavailable values as `null`.
- Impact: KPI dashboards cannot report real platform values until a read-only source is connected.
- Safest current behavior: Preserve `null` rather than infer zero, and keep metrics collection incapable of X writes.
- Needed answer: Supply the authorized read-only metrics source.
- Resolution: The manual publication mapping is implemented as the audited `cubelic.published-post-mapping.v1` contract. Only handed-off drafts may be mapped; collection rejects unknown post ids, and summaries join metrics to the required content dimensions. Connecting a real read-only metrics provider remains pending on entitlement.

## DG-013 — Canonical song and member masters

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §5, §10, §17, §24.3; the official harvest profile currently lists six display names, while no authoritative stable ids, aliases, active-status export, or canonical song catalog exists in the workspace. The public setlist archive is explicitly unofficial.
- Conflict/gap: Phase 1 can validate that identifiers are present and setlist positions are consistent, but public display names and unofficial setlists cannot prove canonical ids, aliases, activity, or the complete song catalog.
- Impact: `song_unknown`, `member_unknown`, setlist reconciliation and member-focused generation.
- Safest current behavior: Accept only human-approved versioned song/member masters; setlist ingestion rejects unknown, inactive, or title-mismatched songs and never guesses a mapping.
- Needed answer: Approve stable ids, aliases and active status for the six officially listed members, and provide a complete human-approved song master from an authoritative source.
- Resolution: Contract, D1 storage, human-only import and fail-closed song reconciliation are implemented; the actual production catalog export remains pending.

## DG-014 — Atomic state and audit commits

- Status: RESOLVED
- Evidence: `SPEC.md` §20, §23.3, §26; `apps/worker/src/routes/cubelic.ts`
- Conflict/gap: State mutations and their audit inserts currently execute as separate D1 operations. A later audit failure can leave changed state without the required audit record; setlist ingestion also folds several entity changes into one command-level audit event.
- Impact: Forensic completeness, reliable rollback and the Phase 1 audit acceptance criterion.
- Safest current behavior: Keep the system undeployed, preserve append-only audit triggers, and fail production preflight until command-level atomic D1 batches with per-entity audit events and failure-injection tests are implemented.
- Needed answer: Confirm whether command-level D1 batches are the transaction boundary, and approve the per-entity audit action vocabulary for multi-entity commands.
- Resolution: Every CUBΣLIC persistence helper now requires audit input and executes state SQL plus append-only audit SQL in one D1 batch. Multi-row draft and master commands emit per-entity events. A Miniflare failure-injection test proves a rejected audit statement rolls back its paired state mutation. Multi-step HTTP commands may remain partially completed, but every committed step is audited and idempotently recoverable.

## DG-015 — Post-event video category state window

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §6.2 says `digest_ready` produces a live digest and requires generation to stop on state mismatch, but does not separately assign `member_focus` and `song_focus` to event states.
- Conflict/gap: Allowing those categories before video preparation is complete could bypass the event-state gate; allowing them after archival could create new event-derived drafts from a closed event.
- Impact: Draft eligibility at generation and final human approval.
- Safest current behavior: In Phase 1, require exactly `digest_ready` for `live_digest`, `member_focus`, and `song_focus`. Revalidate the same rule immediately before handoff. `setlist_flash` remains valid from `setlist_confirmed` onward.
- Needed answer: Decide whether `member_focus` and `song_focus` should also be generated from `archived` events, with a distinct archival template family.
- Resolution: Pending; the fail-closed Phase 1 rule above is implemented until the content policy is approved.

## DG-016 — Production account bootstrap order

- Status: RESOLVED
- Evidence: `docs/deployment-checklist.md` “Before staging” requires replacing the production `X_HARNESS_ACCOUNT_ID` placeholder before deployment; `scripts/preflight-production.mjs` rejects that placeholder; the production D1 database currently contains no application tables or `x_accounts` row; the production Worker does not yet exist.
- Conflict/gap: The required production X Harness row id can only be obtained after account setup, but the documented release gate forbids deploying the Worker needed to perform that setup while the row id is absent.
- Impact: Production D1 initialization, Worker creation, X account OAuth setup, `X_HARNESS_ACCOUNT_ID`, secret provisioning, and release eligibility.
- Safest current behavior: Keep the production Worker undeployed and the operator UI fail-closed; do not invent an account row or promote staging/redacted credentials as production truth. Independent code, staging validation, DNS, Pages, and Access work may continue.
- Needed answer: Authorize either (a) a separately named, publishing-disabled bootstrap Worker bound to production D1 solely for account setup, followed by deletion after the production row id is captured, or (b) an approved manual import of an existing production `x_accounts` row through a secret-bearing operator channel.
- Resolution: The user approved option (a). On 2026-07-22, the fail-closed bootstrap registered production account `tubelic_cube` as internal id `89f9bfc0-428c-480b-9cb3-9ba1698c30da`, with a redacted audit event. That id is now the production `X_HARNESS_ACCOUNT_ID`. The temporary Worker, custom API domain, source entry point, and functional Pages deployment were removed after verification; the undeletable latest Pages branch alias was replaced by an Access-protected, no-store, noindex retirement page.

## DG-017 — Phase 1 release gates versus deferred runtime inputs

- Status: RESOLVED
- Evidence: `SPEC.md` §26 assigns active Hermes Cron/Bridge to Phase 2; DG-002, DG-003 and DG-013 classify real GAS, Resolve and master exports as non-blocking; `scripts/preflight-production.mjs` previously required all of them plus `HERMES_ACCESS_TOKEN` for every Phase 1 infrastructure release.
- Conflict/gap: The production preflight promoted deferred capability inputs into unconditional base-runtime blockers.
- Impact: A publishing-disabled Phase 1 Worker and operator shell could not be released without activating or credentialing deferred integrations.
- Safest current behavior: Keep Hermes runtime and production content ingestion disabled by default; require their credentials and validated real inputs only when their explicit enable flags are true. Independently require safe mode, global publishing disable, human/API separation, production CORS, account mapping and staging smoke for every release.
- Needed answer: Whether to separate content ingestion into finer GAS, member and Resolve capability flags when each production integration is activated.
- Resolution: The user approved separating Phase 1 from Phase 2/deferred inputs. `HERMES_RUNTIME_ENABLED` and `PRODUCTION_CONTENT_INGEST_ENABLED` default to false; preflight conditionally requires `HERMES_ACCESS_TOKEN` or `PRODUCTION_INPUTS_VALIDATED` only when the respective capability is enabled. The operator UI remains in build-time maintenance mode until the production API passes smoke verification.

## DG-018 — Cloudflare release authentication proof

- Status: RESOLVED
- Evidence: `SPEC.md` §21.1 forbids storing Cloudflare tokens in Git; `docs/required-production-inputs.md` required a least-privilege API token; the manual production release is authenticated through Wrangler's encrypted OAuth store and `wrangler whoami` succeeds without exposing a token to the release shell.
- Conflict/gap: Preflight required the raw `CLOUDFLARE_API_TOKEN` environment value even when Wrangler already held a working encrypted credential.
- Impact: Operators were pushed to duplicate a deployment credential into process environment solely to satisfy preflight.
- Safest current behavior: CI uses a least-privilege API token. A manual release may instead set `CLOUDFLARE_AUTH_VERIFIED=true` only after `wrangler whoami` succeeds for the intended account; neither path prints or copies the credential.
- Needed answer: None for the current manual Phase 1 release. Replace the broad interactive OAuth grant with a narrower release identity before unattended deployment is enabled.
- Resolution: Production preflight now accepts either a non-empty minimum-length `CLOUDFLARE_API_TOKEN` or the explicit post-`wrangler whoami` attestation. The current release remains manual and Hermes cannot access either credential.

## DG-019 — Missing or malformed emergency-stop state

- Status: RESOLVED
- Evidence: `SPEC.md` §20 and the repository safety rules require a missing emergency-stop state to fail closed; migration 018 originally seeded `false` and its triggers treated a missing value as resumed.
- Conflict/gap: An absent or non-canonical flag could allow database mutation even though no operator had explicitly resumed the system.
- Impact: Rights, privacy, approval and incident controls could be bypassed after partial migration, manual damage or malformed state.
- Safest current behavior: New installations start stopped. Application reads and database triggers treat every value except the exact string `false` as stopped.
- Needed answer: None for Phase 1.
- Resolution: Migration 019 recreates every emergency-stop trigger with fail-closed semantics and safely defaults missing or invalid state to stopped. Integration tests cover initial, missing, invalid, resumed and stopped states.

## DG-020 — Variant component of draft idempotency

- Status: RESOLVED
- Evidence: `SPEC.md` allows up to three variants but its abbreviated idempotency formula omitted `variant`; ADR-001 and the implemented canonical draft contract include it.
- Conflict/gap: Without the variant component, the three approved review candidates for one content/template/media tuple would collide.
- Impact: Valid variants could overwrite or collapse into one draft; retry behavior would be ambiguous.
- Safest current behavior: Hash `account_id + content_id + template_version + variant + media_sha256_or_none`. Keep the variant in the stored, reviewed contract.
- Needed answer: None for Phase 1.
- Resolution: The variant component is an intentional, versioned extension. Retries of the same variant converge, while the maximum three distinct review candidates remain distinct.

## DG-021 — Production input bundle coherence

- Status: RESOLVED
- Evidence: `SPEC.md` §22.1–22.2, §24.2–24.3; `packages/schemas/src/validate-production-inputs.mjs`; ADR-006
- Conflict/gap: Individually schema-valid GAS, Resolve, song-master and member-master files could still refer to different events, inconsistent songs, duplicate stable ids, or media bytes outside the declared export root. The authoritative LP update-state mapping remains separately pending under DG-009.
- Impact: A release gate could approve inputs that later fail ingestion, bind metadata to the wrong event, or trust an unrelated/tampered media file.
- Safest current behavior: Treat the four JSON files, export root and referenced media as one fail-closed production bundle without logging identifiers, payloads or paths.
- Needed answer: None for Phase 1.
- Resolution: For the supplied local contracts, the production validator requires matching event ids, consecutive setlist positions, active canonical song id/title-or-alias matches, unique song/member ids, a realpath-confined media file, and an exact streaming SHA-256 match. Contract tests cover each rejection and one complete accepted bundle. This does not establish LP publication/update state; production preflight separately requires `PRODUCTION_LP_MAPPING_VALIDATED=true`, backed by the human-approved authoritative mapping required in DG-009.

## DG-022 — Upstream merge availability

- Status: RESOLVED
- Evidence: Upstream PR `Shudesu/x-harness-oss#9` is mergeable but requires an upstream maintainer; the user directed work to continue without relying on that merge.
- Conflict/gap: Treating upstream merge as a release prerequisite would block independent safety work and production operations even though the fork and deployed Cloudflare resources are controlled separately.
- Impact: Release provenance, patch publication, rollback references and future upstream synchronization.
- Safest current behavior: Use the exact commit on `Y-Fukiya/x-harness-oss:agent/cubelic-phase1-release` as the operational source of truth, retain the upstream PR for optional later integration, and never claim that upstream contains the fork changes.
- Needed answer: None for the current Phase 1 operation.
- Resolution: Upstream merge is deferred and is not a Phase 1 operational gate. All releases and checks must record the fork commit SHA until an upstream maintainer merges or supersedes PR #9.
