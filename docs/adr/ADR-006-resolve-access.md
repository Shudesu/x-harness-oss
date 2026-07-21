# ADR-006 — Use an allowlisted sidecar handoff for Resolve media

- Status: Accepted for Phase 1 contract; watcher deferred
- Date: 2026-07-21

## Decision

Phase 1 does not let the Worker scan local disks. A local operator/Hermes-side process will eventually read one configured export root, compute SHA-256/ffprobe metadata, and submit a versioned sidecar contract to `/api/cubelic/media/validate`.

## Rationale

Cloudflare Workers cannot access the editor's local filesystem, and the real Resolve path/sidecar format is not supplied. Explicit handoff avoids broad path access and path traversal.

## Consequences

- The API rejects paths containing traversal and requires a hash.
- Media bytes are never uploaded by the Phase 1 validation endpoint.
- The watcher and real sidecar mapping remain gated by DG-003.
