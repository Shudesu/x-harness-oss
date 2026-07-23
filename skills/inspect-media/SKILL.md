---
name: inspect-media
description: Validate CUBΣLIC Resolve media metadata, hashes, quality, rights evidence, and manual privacy review. Use when a new exported clip sidecar is ready; never infer rights or identify people.
---

# Inspect Media

1. Accept metadata only from the configured export handoff. Require an absolute allowlisted path and SHA-256.
2. Require duration, resolution, orientation, audio and sync results.
3. Require event filming confirmation, publishing permission, song scope and a non-empty evidence reference.
4. Require a human privacy review whenever audience, staff, other performers, readable personal data, or third-party faces may be visible.
5. Call `cubelic_validate_media`. Preserve every structured reject reason.
6. If accepted, call `cubelic_validate_rights` once more before requesting draft generation.

Never run face recognition, infer a member, download another person's video, or bypass `rights_unconfirmed`, `third_party_visible`, or `duplicate_media`.
