# Discovery — CUBΣLIC Content OS Phase 1

Created: 2026-07-21

Last audited: 2026-07-23

## Inputs and authority

| Artifact | Status | Authority | Evidence |
|---|---|---|---|
| Supplied implementation specification | Draft for Implementation v0.1 | Source document | Attachment SHA-256 `849ffb4d3eeffdff7567ded604314157eba381f0c08938c705240343c1795eea` |
| `SPEC.md` | Draft for Implementation v0.1 | Normative for this fork | Byte-identical to the supplied attachment except for a normalized terminal newline; SHA-256 `8da641da77af5758a895fb0f843766f84ff24e94d9de68bcba0b55077ee3017b` |
| X Harness OSS | Upstream `main` | Integration source; subordinate to `SPEC.md` | Commit `6864997739bef11dcd5f5c36af85080e54786bfa` (2026-07-18) |
| Hermes Agent | Locally installed v0.18.2 | Runtime capability evidence | Upstream `7b5ba205`; local CLI inspection |
| `cubelic-fan.com` | Live site | Informative source-shape evidence | Inspected 2026-07-21 |

## X Harness findings

- Stack: Cloudflare Worker/Hono, D1, Next.js 15, TypeScript SDK, MCP, X API v2 and OAuth 1.0a.
- `POST /api/posts` publishes immediately. `POST /api/posts/schedule` inserts a scheduled record, and the five-minute Worker Cron publishes due records.
- The upstream MCP exposes publishing, scheduling, deletion, reply, DM, engagement, follow/unfollow and Cookie-based scraping capabilities.
- Upstream has a `growth_drafts` approval queue, but approval converts the item into an executable scheduled post; this does not satisfy Phase 1.
- Upstream has no inert, unscheduled X draft contract. This fork adds a dedicated adapter-owned inbox that cannot publish.
- Current Worker auth distinguishes admin/editor/viewer but does not distinguish a human operator from Hermes. Human approval therefore needs a separate secret gate.

## Hermes findings

- Local version: Hermes Agent v0.18.2 (2026.7.7.2).
- Cron supports create/edit/pause/resume/run/remove/status/tick and executes through the Gateway.
- Cron jobs run in fresh sessions. A `workdir` must be set for repository instructions and local paths to be loaded.
- Hermes Phase 2 remains out of scope. Phase 1 supplies contract fixtures and the least-privilege API boundary only.

## Site findings

- The public site exposes a schedule hub, beginner guide, setlist archive, Spotify destinations and official-source links.
- The official harvest profile currently lists six member display names, but does not provide the stable ids, aliases and active-status fields required by the member-master contract.
- The public setlist archive exposes date/slug detail routes, including `/setlists/2026-07-14/afterimage-trace/`, but identifies itself as unofficial. Event and setlist JSON endpoints were not discoverable from the rendered public pages.
- Public page text and unofficial setlists are review evidence only; they are not promoted into production master data.
- The actual GAS payload, stable event identifiers and Resolve sidecar format were not supplied to this workspace.
- Phase 1 therefore fixes versioned local contract fixtures; production mapping remains a deferred integration decision.

## X policy risk review

- [X's April 2026 automation rules](https://help.x.com/en/rules-and-policies/x-automation) prohibit non-API website scripting and automated likes, and restrict unsolicited automated replies/DMs and aggressive automated follows.
- The upstream Cookie scraper and auto-engagement surfaces are not used by this fork.
- Phase 1 creates inert drafts only; an operator must explicitly approve, and no code path publishes to X.
- Final body validation uses the official [twitter-text](https://github.com/twitter/twitter-text) conformance implementation for X weighted length.

## Implementation consequences

- D1 remains the store to minimize integration surface.
- CUBΣLIC APIs live under `/api/cubelic`; the Phase 1 Worker uses a compile-time route allowlist and blocks every legacy route, including X-backed GET requests, before authentication or route handlers run.
- Worker Cron performs no X write in safe mode.
- A deterministic template engine is used in Phase 1 so an unspecified model/provider cannot change the publication contract.
- Every external integration is represented by a typed adapter and a fixture-backed contract test.

Open decisions and reversible assumptions are tracked in `docs/Decision-Grill.md`.
