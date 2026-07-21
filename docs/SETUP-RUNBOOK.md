# X Harness Setup Runbook

## Current Status

- Repository: `/Users/tsuneharahirochika/SNSナレッジ/x-harness-oss`
- Dependencies: installed with `pnpm@9.15.4`
- Local D1 schema: applied successfully
- Local D1 schema: re-applied after adding missing runtime tables
- Worker API: verified at `http://localhost:8787`
- Admin UI: verified at `http://localhost:3002`
- Tests: `24 passed`
- Typecheck: passed
- Web production build: passed

Local API key is stored in `apps/worker/.dev.vars`.

## Local Commands

If `pnpm` is installed globally:

```bash
pnpm install
pnpm -r typecheck
pnpm test
pnpm -r build
pnpm --filter worker dev
pnpm --filter web dev
```

In the current environment, `pnpm` is available through the downloaded npx cache:

```bash
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs -r typecheck
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs test
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs -r build
```

Apply local D1 schema:

```bash
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs --filter worker exec wrangler d1 execute x-harness --config wrangler.toml --file=../../packages/db/schema.sql --local
```

Start local services:

```bash
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs --filter worker dev
node /Users/tsuneharahirochika/.npm/_npx/32b21065a482fe57/node_modules/pnpm/bin/pnpm.cjs --filter web dev
```

## Local Verification

Worker health:

```bash
curl -s http://localhost:8787/api/health
```

Authenticated API:

```bash
curl -s \
  -H "Authorization: Bearer <LOCAL_API_KEY>" \
  http://localhost:8787/api/x-accounts
```

Admin UI:

```text
http://localhost:3002/login
```

## Code Changes Made

- Added `DOM` to `tsconfig.base.json` so SDK packages can typecheck Fetch APIs.
- Added OAuth 1.0a credential fields to the admin account form:
  - Consumer Key
  - Consumer Secret
  - Access Token Secret
- Expanded the admin API client types for X account create/update payloads.

## Cloudflare Status

Wrangler can identify the Cloudflare account, but the current `CLOUDFLARE_API_TOKEN` cannot access D1.

Observed errors:

```text
/memberships: Authentication failed (code: 9106)
/accounts/<account-id>/d1/database: Authentication error (code: 10000)
```

Before remote deployment, update or replace the Cloudflare API token so it can manage:

- Workers scripts
- Workers routes or workers.dev deployment
- D1 databases
- Pages projects, if deploying the admin UI to Cloudflare Pages
- Account-level access for the target Cloudflare account

After the token is fixed, run:

```bash
pnpm --filter worker exec wrangler d1 create x-harness
```

Copy the returned `database_id` into `apps/worker/wrangler.toml`, then apply the remote schema:

```bash
pnpm --filter worker exec wrangler d1 execute x-harness --file=../../packages/db/schema.sql --remote
```

Set the production API key:

```bash
pnpm --filter worker exec wrangler secret put API_KEY
```

Deploy the Worker:

```bash
pnpm --filter worker deploy
```

Deploy the admin UI:

```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://<worker-url> pnpm build
pnpm exec wrangler pages deploy out --project-name=x-harness-admin
```

## X Developer Values Needed

For the production X account, prepare:

- X numeric user ID
- X username without `@`
- Consumer Key
- Consumer Secret
- Access Token
- Access Token Secret

Recommended X app permission:

- Read and Write for posting, replies, likes, reposts, follower reads, and history
- Direct Message permission only if DM automation will be used

## Safe Production Order

1. Deploy Worker and D1.
2. Deploy admin UI.
3. Log in with the production `API_KEY`.
4. Register the X account.
5. Keep `auto_features_enabled` off.
6. Verify read-only pages first: account list, post history, mentions, usage.
7. Create one manual test scheduled post or one draft-like low-risk post.
8. Enable automatic features only after a small test gate is reviewed.

## Security Notes

- Do not commit `.dev.vars`, `.env`, access tokens, or API keys.
- X account credentials are stored in D1 by this OSS implementation.
- Restrict Cloudflare dashboard/API token access to trusted operators only.
- Use staff API keys for other users instead of sharing the root `API_KEY`.
- Keep automated DM/reply campaigns opt-in, low-volume, and easy to stop.
