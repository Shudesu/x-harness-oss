# Discovery — CUBΣLIC Content OS Phase 1

Date: 2026-07-21

## Inputs and authority

| Artifact | Status | Authority | Evidence |
|---|---|---|---|
| `SPEC.md` | Draft for Implementation v0.1 | Normative for this fork | Copied from the supplied attachment; terminal newline normalized |
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
- Event and setlist JSON endpoints were not discoverable from the rendered public page.
- The actual GAS payload, stable event identifiers and Resolve sidecar format were not supplied to this workspace.
- Phase 1 therefore fixes versioned local contract fixtures; production mapping remains a deferred integration decision.

## X policy risk review

- [X's April 2026 automation rules](https://help.x.com/en/rules-and-policies/x-automation) prohibit non-API website scripting and automated likes, and restrict unsolicited automated replies/DMs and aggressive automated follows.
- The upstream Cookie scraper and auto-engagement surfaces are not used by this fork.
- Phase 1 creates inert drafts only; an operator must explicitly approve, and no code path publishes to X.
- Final body validation uses the official [twitter-text](https://github.com/twitter/twitter-text) conformance implementation for X weighted length.

## Implementation consequences

- D1 remains the store to minimize integration surface.
- CUBΣLIC APIs live under `/api/cubelic`; legacy mutating/automation routes are blocked whenever safe mode is enabled.
- Worker Cron performs no X write in safe mode.
- A deterministic template engine is used in Phase 1 so an unspecified model/provider cannot change the publication contract.
- Every external integration is represented by a typed adapter and a fixture-backed contract test.

Open decisions and reversible assumptions are tracked in `docs/Decision-Grill.md`.
