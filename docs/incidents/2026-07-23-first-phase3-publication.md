# First Phase 3 publication — authentication stop

- Date: 2026-07-23
- Environment: production
- Severity: contained go-live blocker
- External post created by the original attempt: no matching post found
- Recovery status: resolved by an explicitly approved, separately identified retry

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

## Resolution

1. OAuth 1.0a User Context credentials were stored through macOS Keychain and
   verified with `/2/users/me` as `tubelic_cube` (`1556917966587166720`).
2. Production D1 received the four credential fields and a secret-free
   `x_account.credentials_updated` audit event.
3. A read-only timeline check again found no matching original post.
4. The user explicitly authorized failing the unresolved job and performing
   one new first-publication attempt.
5. Job `pub_e372eabf-6f4d-41a1-b5a4-1b599538b424` was changed from
   `publishing` to `failed` with `reconciled_no_matching_post`.
6. The approved draft received a new audited retry idempotency key. Job
   `pub_9464340d-2bee-4dfb-8850-d864739161e5` then completed as X post
   `2080209283598487956` at `2026-07-23T08:31:56.462Z`.
7. The X timeline contained that post ID and the approved fixed-text prefix.
   The URL portion was normalized by X, so exact comparison against the
   original URL-bearing text is not a valid reconciliation rule.
8. The D1 emergency stop was reactivated immediately after the retry; effective
   publishing and scheduling returned to false.
