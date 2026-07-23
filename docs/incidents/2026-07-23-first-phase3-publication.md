# First Phase 3 publication — authentication stop

- Date: 2026-07-23
- Environment: production
- Severity: contained go-live blocker
- External post created: no matching post found

## Sequence

1. The user explicitly approved the production D1 resume and the exact first
   post text.
2. Readiness checks confirmed the D1 stop was active and publication-job count
   was zero.
3. The named `Y-Fukiya` operator resumed normal operation.
4. The human-attested draft was created and approved.
5. The X delivery request returned an unknown outcome, so the job remained
   `publishing` and was not retried.
6. A read-only timeline query found no exact or fixed-text-prefix match in the
   latest ten account posts.
7. A read-only `/2/users/me` check identified the configured token as OAuth 2.0
   Application-Only, which X rejects for User Context endpoints.
8. The production D1 emergency stop was reactivated and effective publishing
   and scheduling returned to false.

## Recovery gate

Replace the application-only token through the approved secret channel with
OAuth 1.0a User Context credentials or OAuth 2.0 User Context credentials
authorized for tweet read/write and user read. Reconcile the existing
`publishing` job before any separately approved retry. Do not print, commit, or
send the credential in chat.
