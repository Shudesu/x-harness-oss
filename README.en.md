# X Harness

**日本語版は [README.md](./README.md) をご覧ください。**

Open-source marketing automation for X (Twitter). A free (or very low cost) self-hosted alternative to paid social marketing SaaS — engagement gates, campaign wizard, DM management, follower analytics, an AI-agent-ready MCP server, and a TypeScript SDK, all running on Cloudflare's free tier.

## Features

- **Engagement gates** — reply + like/repost/follow conditions with LINE integration and a verify API
- **Campaign wizard** — post → conditions → LINE reward → preview in 4 steps
- **Post management** — text/image/video posts, threads, scheduled posts
- **Reply management** — inbox view, one-click like/repost, replies, own-reply display
- **Quote tweets** — auto-detection, DB persistence beyond X's 7-day API limit
- **DM management** — conversation list with profiles, message history, send/receive
- **Follower management** — gate-captured followers, tagging, segments
- **Follower tracking** — daily snapshots, trend graphs, 7/30-day deltas
- **API usage** — cost visibility per endpoint and per gate
- **Staff management** — owner / admin / editor / viewer RBAC with per-key permissions
- **MCP server** — operate X from Claude Code / AI agents in natural language (61 tools, Codex CLI compatible)
- **Free scraping** — cookie-based search/post/metrics collection with zero X API read costs (`scrape_*` tools via twitter-cli)
- **Article automation** — long-form X Articles with automatic inline image upload from markdown, plus a growth content pipeline (discover → draft → review)
- **SDK** — fully-typed TypeScript SDK covering the whole API
- **Dashboard** — Next.js admin UI
- **Multi-account** — sidebar account switcher, all pages follow the selection
- **LINE Harness integration** — cross-platform campaigns (X → LINE reward delivery)
- **Stealth design** — jitter, self-imposed rate limits, template variation

## Tech stack

| Layer | Technology |
|-------|------------|
| API / Webhook | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| Scheduling | Workers Cron Triggers (every 5 min) |
| Dashboard | Next.js 15 (App Router) + Tailwind CSS |
| SDK | TypeScript, ESM + CJS, zero dependencies |
| MCP server | Model Context Protocol, built on `@x-harness/sdk` |
| X integration | X API v2 + OAuth 1.0a |

## Architecture

```
X Platform (API v2) ←→ CF Workers (Hono) → D1
                              |
                        Cron (*/5 * * * *)
                              |
                   Reply detection (since_id)
                   + follower snapshots
                   + quote-tweet persistence

Next.js 15 (Dashboard) → Workers API → D1
TypeScript SDK → Workers API → D1
MCP Server → Workers API → D1
LINE Harness → Verify API → D1
```

The reply-trigger architecture uses `since_id` incremental fetches, cutting X API costs from ~$86/mo (full like/repost scans) to **$3–5/mo per gate**.

## Quick start (5-minute deploy)

### Prerequisites

- Node.js 20+, pnpm 9+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier)
- An [X developer account](https://developer.x.com/) (Pay-Per-Use recommended)

### Easiest: the CLI

```bash
npm create x-harness@latest
```

The wizard handles cloning, D1 creation, schema, X credentials, and deployment.

### Manual

```bash
git clone https://github.com/Shudesu/x-harness-oss.git
cd x-harness-oss
pnpm install

# Create the D1 database and apply the schema
npx wrangler d1 create x-harness   # put the database_id into apps/worker/wrangler.toml
npx wrangler d1 execute x-harness --file=packages/db/schema.sql

# Set the dashboard API key and deploy the worker
npx wrangler secret put API_KEY
cd apps/worker && npx wrangler deploy

# Register your X account
curl -X POST https://your-worker.workers.dev/api/x-accounts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"xUserId":"...","username":"...","accessToken":"...","accessTokenSecret":"...","consumerKey":"...","consumerSecret":"..."}'

# Deploy the dashboard
cd apps/web
NEXT_PUBLIC_API_URL=https://your-worker.workers.dev npx next build
npx wrangler pages deploy out --project-name=x-harness-admin
```

## MCP server (AI integration)

```json
// .mcp.json
{
  "mcpServers": {
    "x-harness": {
      "command": "npx",
      "args": ["-y", "@x-harness/mcp@latest"],
      "env": {
        "X_HARNESS_API_URL": "https://your-worker.workers.dev",
        "X_HARNESS_API_KEY": "your-api-key"
      }
    }
  }
}
```

61 tools across posts, engagement, gates, campaigns, DMs, step sequences, followers, staff, usage analytics, X Articles, free scraping, and the growth pipeline. See [packages/mcp](./packages/mcp/README.md) for the full list.

## Packages

| Package | Description |
|---------|-------------|
| [`@x-harness/sdk`](./packages/sdk) | TypeScript SDK (ESM + CJS, zero deps) |
| [`@x-harness/mcp`](./packages/mcp) | MCP server for AI agents |
| [`create-x-harness`](./packages/create-x-harness) | Interactive setup CLI |

## Project layout

```
x-harness/
├── apps/
│   ├── web/                # Next.js dashboard
│   └── worker/             # Cloudflare Workers API
├── packages/
│   ├── db/                 # D1 schema & queries
│   ├── sdk/                # TypeScript SDK (@x-harness/sdk)
│   ├── mcp/                # MCP server (@x-harness/mcp)
│   ├── x-sdk/              # X API v2 wrapper
│   ├── shared/             # Shared types
│   └── create-x-harness/   # Setup CLI
└── docs/
    └── SPEC.md             # API specification
```

## Cost

| Usage | Monthly cost |
|-------|--------------|
| 1–2 gates (normal traffic) | **$3–5** |
| Viral post (5,000+ likes) | $20–45 |
| Infrastructure (CF free tier) | **$0** |

## LINE Harness integration

X Harness exposes a verify API for cross-platform campaigns:

```
GET /api/engagement-gates/:id/verify?username=johndoe

{
  "eligible": true,
  "conditions": { "reply": true, "like": true, "repost": true, "follow": true }
}
```

The campaign wizard automates LINE Harness form creation and link generation end-to-end.

## License

MIT
