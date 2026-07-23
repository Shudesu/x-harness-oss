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
4. Keep the D1 emergency stop active and have a named human call
   `POST /api/cubelic/admin/publications/:jobId/reconcile` with the normal
   bearer API key and `X-Human-Approval-Key`. The endpoint performs no X write.
5. If the post exists, submit its numeric id and UTC publication time:

   ```json
   {
     "outcome": "published",
     "postId": "2080209283598487956",
     "publishedAt": "2026-07-23T08:31:56.000Z"
   }
   ```

   This completes the existing job without creating a second post.
6. If no post exists, submit the evidence summary without post bodies:

   ```json
   {
     "outcome": "not_published",
     "evidence": {
       "recentPostsChecked": 10,
       "postIdMatchFound": false,
       "fixedTextPrefixMatchFound": false
     }
   }
   ```

   At least ten posts and both explicit no-match values are required. The
   endpoint atomically fails the unknown job and returns a new retry
   idempotency key.
7. Confirm `GET /api/cubelic/admin/status` reports both
   `emergencyStop: true` and `emergencyStopValid: true`, then run
   `pnpm verify:production-safety:keychain` and confirm the reconciliation audit
   actions under the request correlation id. A returned retry identity is not
   permission to publish: resumption and any retry require separate named-human
   approval.
8. Do not repair these states with direct D1 writes while the reviewed DG-026
   endpoint is available.
