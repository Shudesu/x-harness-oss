# ADR-004 — Add a focused approval page to the existing Next app

- Status: Accepted for Phase 1
- Date: 2026-07-21

## Decision

Add `/cubelic` to the existing Next.js dashboard. The page lists drafts, permits text editing, shows rights/quality/review gates, and asks for a human approval secret only at approval time.

## Rationale

Reusing the authenticated dashboard minimizes deployment surface while keeping the operator interaction explicit.

## Consequences

- Approval requires existing API authentication plus the separate human secret.
- The secret is held in component memory only and is never placed in local storage.
- No schedule or publish control is rendered in Phase 1.
