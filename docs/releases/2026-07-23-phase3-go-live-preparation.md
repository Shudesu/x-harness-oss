# Phase 3 go-live preparation — 2026-07-23

## Outcome

DG-024 go-live infrastructure is deployed. Production Phase 3 code and
configuration are enabled, while the D1 emergency stop remains active pending
the explicit approval of the first live-post ceremony.

## Source and review

- Branch: `codex/production-operation`
- Latest release-preflight commit: `a173298`
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

- Worker version: `4f36b935-d20c-416d-b811-fc58b67bb544`
- Delivery mode: `x`
- Enabled policy: `event_notice:event_notice_manual_v1`
- Phase 3 release approval and staging-smoke attestation: active
- Environment stop: disengaged
- D1 emergency stop: active
- Publishing/scheduling effective status: disabled by the D1 stop
- Production publication-job count at verification: zero

## Remaining explicit ceremony

The D1 emergency stop must not be disengaged until the operator explicitly
approves both normal production operation and the exact first-post text.
After approval, resume with the named production staff credential, create and
approve the human-attested text draft, publish it once, manually verify the X
post, and retain the emergency-stop control.
