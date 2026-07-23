# ADR-008 — Validate X copy with the official twitter-text algorithm

- Status: Accepted for Phase 1
- Date: 2026-07-21

## Decision

Use `twitter-text@3.1.0` `parseTweet` for the final text boundary at generation, edit and approval time. Keep Unicode code-point count only as an operator-facing diagnostic.

## Rationale

X does not count every character equally: CJK characters and URLs use weighted rules. A plain 280-code-point ceiling can accept text the platform rejects. The official library supplies the shared conformance algorithm and validity result.

## Consequences

- Japanese text is rejected once its weighted length exceeds 280.
- URL length follows the parser's transformed-URL rules.
- The UI may still display raw code points, but the server remains authoritative.
