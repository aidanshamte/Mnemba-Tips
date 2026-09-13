# Mnemba Tips production deployment

`wrangler.jsonc` is the source configuration used by the Cloudflare Vite plugin.
`pnpm build` generates `dist/server/wrangler.json`; do not edit that output.
The Worker is `mnemba-tips`, bound through `env.DB` to `mnemba-tips-db`
(`9bd94397-cfba-4174-940f-e34fec53e1f5`).

Cloudflare Git build settings: production branch `main`, repository root,
build `pnpm build`, deploy `pnpm exec wrangler deploy --config dist/server/wrangler.json`.
No non-production branch build is needed. Public browsing must not have Cloudflare
Access enabled. Verify these dashboard settings separately from the source config.

## Schema and initial data transfer

1. Run `pnpm exec wrangler whoami` and verify the account/database with
   `pnpm exec wrangler d1 info mnemba-tips-db`.
2. Create a consistent backup with `node scripts/backup-local.mjs`. Never replace
   or convert the live SQLite file. Keep at least one verified backup permanently.
3. Run `python3 scripts/prepare-d1-transfer.py BACKUP.sqlite .sites-runtime/NEW_EXPORT_DIR`.
   It applies all SQL migrations to a temporary database, checks foreign keys,
   compares every exported cell, and emits a count manifest. Provider caches and
   local locks are excluded; provider quota usage, source state and audit data remain.
   SQL is bounded below 100 KB, files around 4 MB. Large saved evidence uses ordered
   staging chunks and a single INSERT, preserving immutable prediction triggers.
4. Run `pnpm db:migrate:production`. Wrangler versions all migrations, including
   the base basketball tables and all football/cron tables.
5. Run `node scripts/import-d1-transfer.mjs .sites-runtime/NEW_EXPORT_DIR` only for
   the initial empty database. It refuses nonempty remote application tables and
   repeated attempts, records progress, and compares all imported table counts.
   If interrupted, inspect the checkpoint and remote data before recovery; never
   blindly rerun a partially imported SQL file.
6. After remote verification, remove only the plaintext `data-*.sql` exports;
   retain the original backup, manifest and import accounting outside Git.

For later schema changes, add ordered SQL migrations and matching runtime schema
modules. `tests/system/cloudflare-deployment.test.mjs` compares the full schema,
including indexes, triggers and constraints, against runtime initialization.

## Scheduled updates

The custom `worker.ts` delegates HTTP to Vinext and scheduled events to existing
IntelligenceService jobs. UTC schedules:

- `0 * * * *`: fixtures, results, models, snapshots.
- `20 */3 * * *`: news, permitted video metadata, reviewed documents.
- `40 3 * * *`: retention, reconciliation, identities, search, calibration, rosters.

D1 leases prevent overlapping scheduled and interactive synchronization. Event IDs
prevent duplicate delivery. Provider retries are capped at three attempts and use
existing quota reservations/backoff. A cooperative four-minute deadline bounds
fetches and subsequent database work; a terminated invocation leaves its lease to
expire after ten minutes. Partial/error outcomes are persisted in `cron_runs` and
existing `update_jobs`; successful jobs are not implied by a registered trigger.
No filesystem backups run in the Worker. Monitor actual CPU/query quotas and
partial results; local tests cannot establish free-tier production capacity.

## Secrets and checks

`MNEMBA_INTERNAL_TOKEN` (at least 32 characters) protects administrative reads and
mutations; configure with `pnpm exec wrangler secret put MNEMBA_INTERNAL_TOKEN`.
Public browsing needs no secret. Optional server-side provider credentials:
`API_FOOTBALL_KEY`, `FOOTBALL_DATA_KEY`, `NEWS_API_KEY`, `YOUTUBE_API_KEY`.
Do not prefix secrets with `VITE_` or `NEXT_PUBLIC_`. `.env.local`, `.dev.vars`,
local databases, backups, exports and tool logs remain ignored.
`MNEMBA_ORIGIN`, execution profiles and Wrangler registry/log settings are local
operator configuration. Worker name, database ID, binding and Cron schedules are
safe source configuration.

Validate with `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json`.
Push the reviewed release to `origin/main` and observe the connected Git build.
Use `pnpm deploy:production` only after diagnosing a missing automatic deployment.
Check the real production URL, protected API behavior and remote data after release.
