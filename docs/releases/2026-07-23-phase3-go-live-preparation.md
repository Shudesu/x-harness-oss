# Phase 3 go-live preparation — 2026-07-23

## Outcome

DG-024 go-live infrastructure is deployed. Production Phase 3 code and
configuration are enabled. The first live-post ceremony initially stopped on
an application-only X credential, then completed through the separately
approved recovery recorded below. The D1 emergency stop is active after the
ceremony.

## Source and review

- Branch: `codex/production-operation`
- Current deployed source commit: `3a28363`
- Current operations-record commit: `968699b`
- Specification review: 0 P0/P1 findings
- Operations/Cloudflare review: 0 P0/P1 findings
- Production preflight: passed with exact Wrangler production-config parity

## Named operator

The first named admin operator is `Y-Fukiya`.

- Staging credential: stored in macOS Keychain as
  `CUBELIC Staging Staff API Key`
- Production credential: stored in macOS Keychain as
  `CUBELIC Production Staff API Key`
- API keys were not printed or committed
- Bootstrap requires both emergency stops, the global administration key, and
  the human-approval key
- Its persistent D1 marker prevents reuse after operator deactivation or
  deletion

## Staging verification

- Delivery mode: `staging_fake`
- Dedicated hostname is matched exactly
- Named manual-input attestation: passed
- Named human approval: passed
- Immediate fake publication: passed with a `staging_fake_*` identifier
- Reviewed-template scheduling: accepted
- No X API call was made

## Production deployment

- Worker version: `62c7ac52-af43-4c26-9912-a061d516fd1b`
- Delivery mode: `x`
- Enabled policy: `event_notice:event_notice_manual_v1`
- Phase 3 release approval and staging-smoke attestation: active
- Environment stop: disengaged
- D1 emergency stop: active
- Publishing/scheduling effective status: disabled by the D1 stop
- Production publication jobs after recovery: one reconciled `failed`, one
  `published`

## First publication outcome

- OAuth 1.0a User Context was verified as `tubelic_cube`
  (`1556917966587166720`).
- The original unknown-outcome job
  `pub_e372eabf-6f4d-41a1-b5a4-1b599538b424` was reconciled to `failed`; no
  matching original post was found.
- The explicitly approved retry job
  `pub_9464340d-2bee-4dfb-8850-d864739161e5` published X post
  `2080209283598487956`.
- D1 and the X timeline agree on the returned post id and approved fixed-text
  prefix.
- The D1 emergency stop was reactivated immediately after completion;
  publishing and scheduling are currently disabled.
- The detailed sequence and recovery evidence are in
  `docs/incidents/2026-07-23-first-phase3-publication.md`.

## Remaining operation gates

- Additional immediate posts require a separately approved draft and named
  human authorization.
- Scheduled delivery remains limited to reviewed
  `category:template_id` policy pairs.
- Media delivery remains disabled pending a reviewed R2-to-X upload and
  reconciliation contract.
- DG-026 outcome-unknown recovery is implemented as a named-human-only
  reconciliation API. It requires the D1 emergency stop, performs no X write,
  and preserves the stop; any later retry still requires separate approval.
