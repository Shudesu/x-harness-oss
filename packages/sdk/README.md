# @x-harness/sdk

TypeScript SDK for [X Harness](https://github.com/Shudesu/x-harness-oss) — open-source X (Twitter) marketing automation. Zero runtime dependencies, ESM + CJS, fully typed.

## Install

```bash
npm install @x-harness/sdk
```

## Quick start

```ts
import { XHarness } from '@x-harness/sdk';

const xh = new XHarness({
  apiUrl: 'https://your-worker.workers.dev',
  apiKey: process.env.X_HARNESS_API_KEY!,
});

// Create an engagement gate (reply trigger + like/follow conditions)
const gate = await xh.engagementGates.create({
  xAccountId: 'acc_xxx',
  postId: '1234567890',
  triggerType: 'reply',
  actionType: 'reply',
  template: 'Thanks! Here is your link: {link}',
  link: 'https://example.com/reward',
  requireLike: true,
  requireFollow: true,
});

// List followers captured by your gates
const followers = await xh.followers.list({ limit: 50, offset: 0 });

// Schedule a post
await xh.posts.schedule('acc_xxx', 'Going live tomorrow 🚀', '2026-08-01T09:00:00+09:00');
```

## Resources

| Resource | Purpose |
|----------|---------|
| `xh.engagementGates` | Create/list/update gates, deliveries, verify API |
| `xh.followers` | Gate-captured followers, tagging, segments |
| `xh.tags` | Tag CRUD |
| `xh.posts` | Posts, threads, scheduling, metrics |
| `xh.users` | UUID users, channel linking (LINE Harness integration) |

All methods return typed responses (`ApiResponse<T>` / `PaginatedData<T>`) and throw `XHarnessError` on API errors, with the HTTP status preserved.

## Requirements

- Node.js ≥ 20 (or any runtime with global `fetch`)
- A deployed X Harness worker ([setup guide](https://github.com/Shudesu/x-harness-oss#readme))

## License

MIT
