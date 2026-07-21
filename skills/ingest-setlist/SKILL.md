---
name: ingest-setlist
description: Validate and ingest a CUBΣLIC GAS setlist payload, then create setlist-flash drafts for human review. Use only with the versioned cubelic.gas-setlist.v1 contract and a known ended event.
---

# Ingest Setlist

1. Require `schema_version: cubelic.gas-setlist.v1`, a known event id, sequential positions, canonical song ids, titles, LP HTTPS URL and confirmation metadata.
2. Refuse unknown songs, empty sets, event/title/venue mismatches, or events that have not ended.
3. Call `cubelic_ingest_setlist` once with the unmodified payload. Treat an idempotent replay as success, not a new setlist.
4. Report the Content Item id and no more than three generated draft ids.
5. Route mismatches to the human review queue; never guess a song mapping.

Do not approve or publish the generated drafts.
