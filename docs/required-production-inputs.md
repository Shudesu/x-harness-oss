# Required Production Inputs

Provide these items through the approved secret/file-transfer channel. Do not paste credentials into issues, commits or chat logs.

The repository reserves the ignored local directory `production-inputs/` for operator handoff. Its contents are excluded by `.gitignore`; do not force-add them. A local README and environment template in that directory describe the expected filenames and validation command.

## Structured payloads

- One redacted real GAS payload matching `packages/test-fixtures/contracts/gas-setlist-v1.json`.
- One redacted real Resolve sidecar matching `packages/test-fixtures/contracts/resolve-metadata-v1.json` and the absolute allowlisted export root.
- Complete human-approved song master matching `packages/test-fixtures/contracts/song-master-v1.json`.
- Complete human-approved member master matching `packages/test-fixtures/contracts/member-master-v1.json`.
- Canonical URL templates or mapping for event, setlist, member and song pages.

The example identifiers and names are test-only and must not be promoted as production truth.

The [official harvest profile](https://www.hvt-inc.com/cubelic/) can be used to review the six current member display names, but it does not supply the required stable ids, aliases or active-status export. The public fan-site setlist archive is explicitly unofficial and must not be converted into a canonical song master without human approval. Its visible `/setlists/<YYYY-MM-DD>/<slug>/` route still requires an authoritative `event_id` mapping.

## Deployment identifiers

- Staging Worker/Web HTTPS origins. The approved production UI origin is `https://ops.cubelic-fan.com`; `https://cubelic-fan.com` remains the public fan site.
- Cloudflare account/project identifiers and separate staging/production D1 ids.
- The selected X Harness `x_accounts.id` row, obtained from the deployment database after account setup.
- The read-only metrics entitlement/source and the contract that maps a manually published X post id back to a CUBΣLIC draft.

## Secrets

- `API_KEY` and `HUMAN_APPROVAL_KEY`: distinct random values of at least 32 characters. `HERMES_ACCESS_TOKEN` is additionally required and must be distinct only when `HERMES_RUNTIME_ENABLED=true` in a later phase.
- For CI, a `CLOUDFLARE_API_TOKEN` with only the resources needed for the selected environment. A manual release may instead use Wrangler's encrypted OAuth credential and set `CLOUDFLARE_AUTH_VERIFIED=true` only after `wrangler whoami` succeeds for the intended account.
- `CORS_ALLOWED_ORIGINS=https://ops.cubelic-fan.com`; no wildcard and no public fan-site origin.

After provisioning, run `pnpm preflight:production` and the staging steps in `docs/deployment-checklist.md`.

Before importing structured files, set `GAS_PAYLOAD_PATH`, `RESOLVE_METADATA_PATH`, `SONG_MASTER_PATH`, `MEMBER_MASTER_PATH`, `RESOLVE_EXPORT_ROOT` and `RESOLVE_EXPORT_ALLOWED_ROOTS`, then run `pnpm validate:production-inputs`. `RESOLVE_EXPORT_ALLOWED_ROOTS` is a comma-separated list of existing absolute directories approved to contain exports. The validator resolves symlinks before checking containment, so an export root that escapes those directories is rejected.

Validation reports environment/schema fields only; it does not print payload contents or local file paths. It rejects repository fixtures, copied fixture fingerprints, known test-only identifiers, missing/non-directory Resolve roots, and roots outside the configured allowlist. The referenced media file must exist inside `RESOLVE_EXPORT_ROOT`, and its bytes must match the sidecar SHA-256.

The four contracts are validated as one production bundle: GAS and Resolve must reference the same event, setlist positions must be consecutive from 1, every setlist song must match an active canonical id/title or alias, and song/member master identifiers must be unique.

This local validation does not prove that the public LP has been updated. Before enabling production ingestion, separately approve the authoritative `event_id` to LP route/state mapping tracked in DG-009, confirm the LP update state, and set `PRODUCTION_LP_MAPPING_VALIDATED=true`. Preflight fails closed if content ingestion is enabled without both this attestation and `PRODUCTION_INPUTS_VALIDATED=true`.
