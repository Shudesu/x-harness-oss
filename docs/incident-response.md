# Incident Response

## Severity

- **SEV-1:** an automated or unauthorized X write, leaked approval credential, or confirmed rights/privacy violation.
- **SEV-2:** unsafe draft entered the inert inbox, account boundary mismatch, audit gap, or repeated validation bypass.
- **SEV-3:** ingestion, generation or metrics failure without external publication.

## First 15 minutes

1. Activate the CUBΣLIC emergency stop and set `GLOBAL_PUBLISHING_DISABLED=true`.
2. Revoke the affected Hermes/API/human approval token. Do not paste it into an issue or chat.
3. Preserve the incident, draft, rights-evidence and append-only audit identifiers.
4. If content was manually published, have an authorized human assess removal and platform reporting. The CUBΣLIC adapter intentionally cannot delete posts.
5. Record UTC/JST time, operator, observed behavior and scope in `cubelic_incidents`.

## Investigation and recovery

Trace the audit correlation id from input contract through validation, generation, approval and inert handoff. Verify account id, content hash, rights expiry, privacy flags and approving actor. Recovery requires an admin, a fresh human approval credential, a reviewed fix, green `pnpm check`, and a documented resume reason.

Never erase audit history to repair an incident. Treat unclear authorization as a rights block. Escalate questions that change policy or contracts into [Decision-Grill.md](Decision-Grill.md).
