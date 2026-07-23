---
name: collect-metrics
description: Collect CUBΣLIC published-post metrics at the configured 2h, 24h, 72h, and 7d windows. Use for measurement jobs; preserve unavailable values as null and never infer performance.
---

# Collect Metrics

1. Require a known published post id and exactly one window: `2h`, `24h`, `72h`, or `7d`.
2. Call `cubelic_collect_metrics` with a stable correlation id.
3. Preserve unavailable fields as `null`; never substitute zero or an estimate.
4. Treat an idempotent repeat for the same post/window as an update to that snapshot.
5. Report collection failures without changing posting policy or triggering a post.
