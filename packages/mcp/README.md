# @x-harness/mcp

MCP (Model Context Protocol) server for [X Harness](https://github.com/Shudesu/x-harness-oss) — operate your X (Twitter) marketing automation from Claude Code or any MCP-capable AI agent, in natural language.

## Tools (61)

- **Posts** — `create_post`, `create_thread`, `reply_to_post`, `schedule_post`, `search_posts`, `get_mentions`, `get_post_metrics`, `delete_post`, …
- **Engagement** — `like_post`, `retweet`, `bookmark`, `follow`, `unfollow`, …
- **Engagement gates** — `create_engagement_gate`, `list_engagement_gates`, `get_gate_deliveries`, `process_gates`, `verify_gate`, `get_gate_analytics`
- **Campaigns** — `create_campaign` (post → conditions → LINE reward in one call)
- **DMs** — `send_dm`, `get_dm_conversations`, `get_dm_messages`
- **Step sequences** — `create_step_sequence`, `add_step_message`, `enroll_user`
- **Users / followers** — `get_followers`, `get_following`, `search_users`, `get_user`
- **Staff & usage** — `list_staff`, `create_staff`, `get_usage_summary`, `get_usage_daily`, `get_usage_by_gate`
- **Account** — `account_summary`, `get_account_subscription`
- **Articles** — `create_article` (inline images via markdown), `publish_article`, `search_news`, `get_news`
- **Free scraping** — `scrape_user_posts`, `scrape_search`, `scrape_post`, `scrape_user` (cookie-based via twitter-cli, zero X API read costs)
- **Growth** — `add_growth_source`, `save_growth_article`, `add_growth_draft`, and listing tools for the content pipeline

## Setup (Claude Code)

```bash
claude mcp add x-harness \
  -e X_HARNESS_API_URL=https://your-worker.workers.dev \
  -e X_HARNESS_API_KEY=your-api-key \
  -- npx -y @x-harness/mcp
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "x-harness": {
      "command": "npx",
      "args": ["-y", "@x-harness/mcp"],
      "env": {
        "X_HARNESS_API_URL": "https://your-worker.workers.dev",
        "X_HARNESS_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_HARNESS_API_URL` | yes | Your deployed X Harness worker URL (defaults to `http://localhost:8787`) |
| `X_HARNESS_API_KEY` | yes | API key (owner or staff key; staff RBAC applies) |
| `LINE_HARNESS_URL` | no | LINE Harness base URL for cross-platform campaigns |

## License

MIT
