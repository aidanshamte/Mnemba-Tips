# Azure migration verification — September 17, 2026

The existing application and reconciled database are running on [Azure-generated HTTPS](https://mnemba-web.livelybush-738e4ce5.westus.azurecontainerapps.io). Football and basketball desktop/mobile journeys passed against production PostgreSQL. Cloudflare remains deployed and its health endpoint reports `database: ready`.

**The custom-domain migration is not complete.** `aidanshamte.me` still resolves to GitHub Pages; `www` points to the apex. Azure verification TXT records are absent, no custom hostname is bound, and custom-domain HTTPS/redirects have not been verified. Namecheap account access is unavailable in this workspace. The user is being guided to Domain List → Manage → Advanced DNS → Host Records. [Exact DNS values and rollback observations](infra/azure/DNS_SETTINGS.md) are ready. No Namecheap certificate upload is needed if Azure managed issuance succeeds.

## Deployment evidence

| Item | Verified value |
|---|---|
| Azure subscription | Azure for Students, `b55deec1-aecc-443f-8d1c-3401a8a6d190`, Enabled, spending limit On |
| Region / resource group | `westus` / `mnemba-azure` |
| Foundation / import / runtime ARM deployments | `mnemba-foundation`, `mnemba-import-job`, `mnemba-runtime`; all Succeeded |
| Deployed source commit | `e2863a5535b52cd60fef940f182b8af3d217c319` |
| GitHub deployment | [Run 35206012277](https://github.com/aidanshamte/Mnemba-Tips/actions/runs/35206012277), Succeeded |
| Image | `mnembab55deec1.azurecr.io/mnemba:e2863a5535b52cd60fef940f182b8af3d217c319` |
| Image digest | `sha256:72eafed060de6caa9df24e08ce474d72c00bcf8062b14ab407f5d2696c6cf1d3` |
| Active web revision | `mnemba-web--0000003` (same image; authenticated updates enabled) |
| Database | Private PostgreSQL 17, `mnemba-pg-b55deec1`, database `mnemba`, schema `production_snapshot` |
| Import execution | `mnemba-import-mfu0896`, Succeeded; replay/count/hash verification at 09:16:38 UTC |
| Public CI verification | 09:39:29 UTC, real HTTPS health/routes/search and database reads passed |
| Cloudflare fallback | [mnemba-tips.kaidan547.workers.dev](https://mnemba-tips.kaidan547.workers.dev), final health recheck passed |

GitHub uses OIDC without a stored Azure client secret. AcrPush is limited to the registry; application/job contributor roles are limited to the individual app and three jobs. Earlier runs failed on the enhanced GitHub subject and missing job-specific permissions; those were corrected and the linked run succeeded. The deployed code includes the PostgreSQL source quota fix found during real-job verification, not just the earlier successful build.

## Data protection and comparison

Both local SQLite databases and the original remote D1 SQL export were backed up before conversion. Off-repository copies are in `/tmp/mnemba-off-repository-backups/`; durable copies are private blobs in `mnembabackupb55deec1/migration-backups`: `local-small.sqlite`, `local-large.sqlite`, `remote-original.sql`, and `reconciled.sqlite`. Blob upload sizes were checked. Workspace `/tmp` alone is not a durable backup. Azure PostgreSQL also has seven-day managed backup retention and a confirmed restore start time.

The smaller local database has no unique application records compared with the larger copy; nine conflicting cache/source-registry metadata rows remain preserved in its complete backup. Reconciliation combined the larger local database and production D1. It archived both original versions for all **3,646** overlapping-key conflicts, preferred the freshest mutable row, and preserved production immutable records. Neither source database was rewritten.

**All 68 migrated table counts and ordered content hashes matched in local PostgreSQL and Azure after importing the same copy twice. Total: 212,135 rows**, including the conflict archive. Nine immutable-history triggers were installed. The migration ledger prevents duplicate replay and rejects an unrelated source snapshot. [Every table's local, D1, reconciled, and Azure count](infra/azure/MIGRATION_COUNTS.md) is recorded separately.

| Selected table | Reconciled local and Azure baseline |
|---|---:|
| fixtures | 11,801 |
| football_teams | 805 |
| football_players | 190 |
| competitions | 39 |
| news_articles | 484 |
| prematch_snapshots | 469 |
| model_predictions | 426 |
| exploratory_estimates | 1,715 |
| recommendation_grades | 33 |
| media_assets / entity_media | 27 / 29 |
| migration_conflicts | 3,646 |

These are migration-baseline counts. At 2026-09-17T09:49:20.164Z, the live Azure audit counted **215,620 rows**, including 11,807 fixtures, 497 news articles and 787 immutable prematch snapshots. The count document includes the current per-table column. Ingestion, indexing and existing retention rules explain later count changes. Cloudflare remains independently active, so later D1 writes are not automatically replicated into PostgreSQL. A final delta reconciliation is required before any future Cloudflare retirement. The original snapshots and conflict archive remain available for recovery.

## Tests and actual public behavior

- 24 existing regression test files passed, including the SQLite source path.
- Azure TypeScript check passed; PostgreSQL integration tests passed for public reads, immutable history, transactional rollback, locks, concurrent provider budgets, and all scheduler groups. The added regression exercises repeated source-budget reservations and refuses network calls when the budget is exhausted.
- The production Docker build passed in GitHub; the original Cloudflare production build passed without redeploying Cloudflare.
- Local rehearsal imports ran twice, and local browser journeys passed before Azure deployment.
- The final CI-deployed Azure image passed 24 desktop/mobile browser checks at widths 1440 and 390: football matchday/fixtures, team and player search, match pages, predictions/history, shortlists, news article media, team and player profiles, basketball selection, legacy route redirect, and overflow checks. No application JavaScript errors or failed application API responses were observed.
- Azure-generated HTTPS has a valid certificate; HTTP returns 301 to HTTPS. `/api/health` confirms PostgreSQL ready. Private admin views return 403 without authorization and 200 with the configured token. Unauthorized POST returns 403; an authenticated invalid action reaches input validation and returns 400. Credentials were read in memory and not printed in the test output.

Existing media limitations are preserved and labelled: club badges load where available; the selected player's image uses the existing labelled fallback because the source snapshot contains no verified player portraits. News uses actual available media or publisher attribution fallbacks. Basketball's restored `/basketball` journey uses the existing clearly labelled model/demo scenarios; there is no live basketball dataset to migrate. Forecast calibration remains insufficient-data where prospective evidence is absent; no improved accuracy is claimed.

## Scheduled updates

All three jobs use the same deployed commit, the restricted database role, a PostgreSQL overlap lock, 0.5 vCPU / 1 GiB, zero automatic retries and a 300-second container timeout. UTC schedules are hourly fixtures/results/models/snapshots (`0 * * * *`), news/video/documents every three hours (`20 */3 * * *`), and daily maintenance (`40 3 * * *`). Both jobs and authenticated web update actions are enabled. Cloudflare schedules remain unchanged; no paid-provider keys were present in either secret inventory.

Live manual verification of these configured scheduled jobs:

| Job / execution | Result |
|---|---|
| `mnemba-update-0-gtbd0j7` | Succeeded: fixtures, results, models, snapshots; nine fixture and six result records fetched, no source errors |
| `mnemba-update-1-eqv54av` | Succeeded: news, video-news and configured documents |
| `mnemba-update-2-tkn8lc9` | Failed / partial: retention, reconciliation, identities, search indexing and calibration completed; both roster requests reported `Wikidata: network unavailable` |

Initial live attempts exposed an ambiguous PostgreSQL `used` column in the source quota upsert. The query was fixed, tested locally, redeployed through the successful CI run, and fixture/news jobs were rerun successfully. Failed earlier executions remain visible. The current maintenance failure is an upstream Wikidata roster connectivity limitation, not reported as a successful update. Existing player and roster records remain available; no source is replaced with fabricated data. A later successful roster fetch is still required to verify that part of daily maintenance. Configured schedules and successful manual executions do not alone prove a future automatic invocation; inspect future execution logs and protected `cron_runs` records.

## Credit, costs, and remaining account work

The account credit API was rechecked after provisioning: **USD 100.00 current and estimated balance**, non-estimated flag, zero pending charges reported. Billing can arrive later. The student grant expires **September 15, 2027**. Allowed-region policy and actual West US service/SKU availability were checked before resource creation.

At current West US retail rates, low-traffic hosting is approximately **USD 30–32/month before student PostgreSQL allowances**, or **USD 9–12/month if those allowances apply**. The latter billing benefit remains unconfirmed; do not assume this deployment is entirely free. Sustained web activity and jobs can increase the total to roughly USD 65–70/month before those benefits. The USD 100 credit covers the initial deployment but not a guaranteed year. [Exact resource settings, cost assumptions and official references](infra/azure/README.md) are documented.

A USD 10 monthly budget has actual 50%/100% and forecast 100% email alerts to `aidan.shamte@student.fairfield.edu`; the student spending limit remains On. Budget alerts are not a hard cap. Account work remaining: enter the Namecheap DNS records, then verify Azure-managed certificates and both hostnames; review PostgreSQL free-service application and accrued costs when metering becomes available. No pay-as-you-go upgrade is requested.

Private verification artifacts, screenshots, count/hash manifests and logs are under `.sites-runtime/azure-migration/`, excluded from Git. Original user documentation changes remain in the working tree. No database exports or credentials are committed. Cloudflare must remain deployed until domain verification and any final D1 delta reconciliation are complete.
