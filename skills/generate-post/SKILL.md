---
name: generate-post
description: Generate up to three CUBΣLIC X draft variants from a validated Content Item. Use when an event, setlist, or approved media asset is ready for human review; never approve, schedule, publish, reply, DM, or alter strategy.
---

# Generate Post

1. Call `cubelic_system_status`. Stop if emergency or environment stop is active.
2. Load the Content Item and confirm `category`, `target_stage`, lifecycle, source and destination are explicit.
3. For media content, call `cubelic_validate_rights`; stop on any rejection reason. Never infer filming or publishing permission.
4. Call `cubelic_generate_drafts` with the validated content and, for video, its asset id.
5. Return at most three variants with the recommended candidate, quality/freshness scores, risks and every human review item.
6. Leave every candidate in the human review queue.

Do not call legacy X Harness tools. Do not approve, schedule, publish, delete, reply, like, follow or send a DM.
