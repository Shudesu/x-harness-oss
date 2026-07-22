# create-x-harness

Interactive CLI to set up [X Harness](https://github.com/Shudesu/x-harness-oss) — open-source X (Twitter) marketing automation, self-hosted on Cloudflare's free tier.

## Usage

```bash
npm create x-harness@latest
```

The wizard walks you through:

1. **Clone** — fetches the X Harness repo (or use `--repo-dir` to point at an existing checkout)
2. **Cloudflare** — creates the D1 database, applies the schema, and configures `wrangler.toml`
3. **X API credentials** — OAuth 1.0a keys for your X developer app
4. **Deploy** — deploys the worker (API + 5-minute cron) and prints your endpoint + API key

After setup, manage everything from the Next.js dashboard (`apps/web`), the [TypeScript SDK](https://www.npmjs.com/package/@x-harness/sdk), or the [MCP server](https://www.npmjs.com/package/@x-harness/mcp) for AI agents.

## Options

| Flag | Description |
|------|-------------|
| `--repo-dir <path>` | Use an existing X Harness checkout instead of cloning |

## Requirements

- Node.js ≥ 20
- A Cloudflare account (free tier is enough)
- An X developer app (Free tier works; costs scale with gate traffic — typically $3–5/mo)

## License

MIT
