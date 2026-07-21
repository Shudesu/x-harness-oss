# Required Production Inputs

Provide these items through the approved secret/file-transfer channel. Do not paste credentials into issues, commits or chat logs.

## Structured payloads

- One redacted real GAS payload matching `packages/test-fixtures/contracts/gas-setlist-v1.json`.
- One redacted real Resolve sidecar matching `packages/test-fixtures/contracts/resolve-metadata-v1.json` and the absolute allowlisted export root.
- Complete human-approved song master matching `packages/test-fixtures/contracts/song-master-v1.json`.
- Complete human-approved member master matching `packages/test-fixtures/contracts/member-master-v1.json`.
- Canonical URL templates or mapping for event, setlist, member and song pages.

The example identifiers and names are test-only and must not be promoted as production truth.

## Deployment identifiers

- Staging and production Worker/Web HTTPS origins.
- Cloudflare account/project identifiers and separate staging/production D1 ids.
- The selected X Harness `x_accounts.id` row, obtained from the deployment database after account setup.
- The read-only metrics entitlement/source and the contract that maps a manually published X post id back to a CUBΣLIC draft.

## Secrets

- `API_KEY`, `HERMES_ACCESS_TOKEN` and `HUMAN_APPROVAL_KEY`: distinct random values of at least 32 characters.
- `CLOUDFLARE_API_TOKEN` with only the resources needed for the selected environment.
- `CORS_ALLOWED_ORIGINS` as exact HTTPS origins; no wildcard.

After provisioning, run `pnpm preflight:production` and the staging steps in `docs/deployment-checklist.md`.

Before importing structured files, set `GAS_PAYLOAD_PATH`, `RESOLVE_METADATA_PATH`, `SONG_MASTER_PATH`, `MEMBER_MASTER_PATH` and `RESOLVE_EXPORT_ROOT`, then run `pnpm validate:production-inputs`. Validation reports schema paths only and does not print payload contents.
