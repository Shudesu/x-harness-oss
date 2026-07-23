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

### Publication outcome unknown

If an X delivery attempt remains `publishing` with
`publication_outcome_unknown`:

1. Activate the D1 emergency stop. Never retry the existing idempotency key.
2. Preserve the job id, draft id, correlation id, attempted time and account id.
   Do not copy the body or credentials into logs.
3. Read the target account through User Context and inspect at least the latest
   ten posts. Reconcile by returned post id first, then by the approved fixed
   text. Do not require literal URL equality because X normalizes links to
   `t.co`.
4. If the post exists, complete the existing job through an audited repair; do
   not create another X write.
5. If no post exists, retain `publishing` until a named human explicitly
   approves both failure reconciliation and a separate retry.
6. Record the evidence count and match result without storing post bodies.
7. Keep direct D1 repair as an exceptional two-person operation until DG-026
   defines and implements the reviewed reconciliation API.
