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

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §27 uses logical id `tubelic_cube`; upstream X Harness stores a generated `x_accounts.id` plus username.
- Conflict/gap: The logical account id is not guaranteed to equal the X Harness row id.
- Impact: Adapter handoff and account isolation.
- Safest current behavior: Resolve through the explicit `X_HARNESS_ACCOUNT_ID` deployment setting and reject a mismatch.
- Needed answer: Provide the production X Harness row id after account setup.
- Resolution: Pending.

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
- Evidence: `SPEC.md` §14; `cubelic-fan.com` renders event and setlist content but no stable JSON endpoint was supplied.
- Conflict/gap: A canonical page URL cannot always be derived from `event_id` alone.
- Impact: UTM destination correctness.
- Safest current behavior: Require an explicit HTTPS `base_url` on each content item and reject hand-entered tracked URLs.
- Needed answer: Provide the canonical event/setlist URL templates or JSON endpoint.
- Resolution: Pending.

## DG-010 — Phase 1 deployment topology

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §7.1, §8, ADR-005 requirement; no Cloudflare account topology or environment list was supplied.
- Conflict/gap: Worker/D1/UI may be one deployment or separate trust zones.
- Impact: CORS, secret placement, rollback and production runbook details.
- Safest current behavior: Keep Planner routes in the existing Worker and approval UI in the existing Next app, with one D1 and no public unauthenticated mutation.
- Needed answer: Confirm staging/production domains and whether the approval UI must be private-network-only.
- Resolution: Pending.

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
- Resolution: Pending.

## DG-013 — Canonical song and member masters

- Status: NON_BLOCKING
- Evidence: `SPEC.md` §5, §10, §17, §24.3; no canonical song/member master fixture or endpoint exists in the workspace.
- Conflict/gap: Phase 1 can validate that identifiers are present and setlist positions are consistent, but cannot prove that an identifier/title pair belongs to the canonical catalog.
- Impact: `song_unknown`, `member_unknown`, setlist reconciliation and member-focused generation.
- Safest current behavior: Accept only human-approved versioned song/member masters; setlist ingestion rejects unknown, inactive, or title-mismatched songs and never guesses a mapping.
- Needed answer: Provide versioned song/member master exports with stable ids and aliases.
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
