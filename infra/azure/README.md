# Mnemba Tips on Azure

The existing application is deployed to [the Azure-generated HTTPS URL](https://mnemba-web.livelybush-738e4ce5.westus.azurecontainerapps.io). Cloudflare remains deployed. See [the verification report](../../AZURE_MIGRATION_REPORT.md), [baseline record counts](MIGRATION_COUNTS.md), and [exact Namecheap records](DNS_SETTINGS.md). Custom-domain verification is separate from the working generated URL.

## Account and infrastructure

Subscription `b55deec1-aecc-443f-8d1c-3401a8a6d190` is Azure for Students, Enabled, spending limit On. The account API confirmed USD 100 remaining credit before provisioning; the student grant expires September 15, 2027. West US is one of the subscription's allowed regions and exposes B1ms PostgreSQL. Container Apps environment quota is one. PostgreSQL's student free-service billing benefit has not been confirmed on an actual usage bill.

| Resource | Deployed configuration |
|---|---|
| Resource group | `mnemba-azure`, `westus` |
| Container Apps environment | `mnemba-env`, Consumption, VNet integrated |
| Web | `mnemba-web`, 0.5 vCPU / 1 GiB, 0–1 replicas, HTTP concurrency 20, port 3000, HTTPS-only |
| Health | `/api/health` checks database availability; startup/liveness TCP probes |
| PostgreSQL | `mnemba-pg-b55deec1`, PostgreSQL 17, Standard_B1ms, 32 GiB, no HA, autogrow disabled |
| Database access | Database `mnemba`, schema `production_snapshot`, runtime role `mnemba_app`; private-only connectivity, TLS certificate validation |
| Recovery | PostgreSQL backup retention 7 days; original SQLite/D1 snapshots in private Blob Storage |
| Network | VNet `10.42.0.0/16`; ACA `10.42.0.0/23`; delegated PostgreSQL subnet `10.42.2.0/28` |
| Private DNS | `mnemba.postgres.database.azure.com` linked to VNet |
| Registry | `mnembab55deec1.azurecr.io`, Basic, admin login disabled, `mnemba-runtime` identity with AcrPull |
| Backup storage | `mnembabackupb55deec1` / `migration-backups`; public blobs and shared keys disabled, HTTPS/TLS 1.2, soft-delete 7 days |
| Logs | `mnemba-logs`, 30-day retention, 0.1 GB daily ingestion cap |
| Budget | `mnemba-monthly`, USD 10/month; actual 50%/100% and forecast 100% alerts to `aidan.shamte@student.fairfield.edu` |

`main.bicep` defines foundation and runtime. Secrets and instantiated parameters are ignored files under `.sites-runtime/azure-migration/`, never source control. Start a new environment with `deployRuntime=false`; push an image, import and verify the data, then deploy runtime. `enableUpdates=false` is the safe staging default. Do not blindly redeploy defaults over the verified environment or overwrite its secrets/image. The separate import job uses administrator access only for migration; the web and scheduled jobs use the limited runtime role. Immutable history triggers remain enforced.

## Runtime and data

`Dockerfile.azure` builds the existing Next.js application with Node 24 and a non-root standalone server. The Azure build replaces the Cloudflare binding import with `lib/azure/bindings.mjs`. `lib/azure/postgres.mjs` implements the application's D1 statement interface, explicit PostgreSQL SQL translations, transactional batches, and quota concurrency locks. The Cloudflare build still uses the original Worker/D1 bindings.

Backups were taken before conversion. A raw remote D1 export is restored in a disposable copy by `scripts/azure/restore-d1-export.py`. `reconcile.py` combines local and remote records without editing either source, retains both row versions in `migration_conflicts`, and checks SQLite integrity and foreign keys. `migrate.mjs` imports in batches, validates every table's row count and ordered content hash, installs immutable-history triggers, and records the source checksum. Running the same snapshot twice verifies existing data rather than duplicating it. A different snapshot is refused in an already migrated schema.

Do not rerun the initial snapshot verifier against an actively updating production schema and interpret legitimate new records as migration failure. Preserve the baseline manifest, then audit current counts and job outcomes separately. There is no continuous D1-to-PostgreSQL replication; any Cloudflare writes after the snapshot need separate reconciliation before its eventual retirement.

Private evidence and manifests: `.sites-runtime/azure-migration/`. Off-repository copies: `/tmp/mnemba-off-repository-backups/` (ephemeral workspace storage); the private Azure blobs provide the durable copy. Never commit exports, connection strings, SAS links, account tokens, or deployment parameter files.

## Updates

| Azure job | UTC cron | Work |
|---|---|---|
| `mnemba-update-0` | `0 * * * *` | Fixtures, results, prediction models, snapshots |
| `mnemba-update-1` | `20 */3 * * *` | News, video metadata, configured documents |
| `mnemba-update-2` | `40 3 * * *` | Retention, country/entity reconciliation, search index, calibration, rosters |

Each scheduled container uses 0.5 vCPU / 1 GiB, one replica, a 300-second execution timeout, zero automatic retries, and a 240-second cooperative application deadline. A PostgreSQL advisory lock prevents overlapping scheduled executions. `MNEMBA_ENABLE_UPDATES=1` is required. Partial source failures make the job fail visibly; cached records remain available. The `cron_runs` and `update_jobs` tables retain protected details. Check both Azure execution status and these application outcomes: process success alone is insufficient.

No API-Football, Football-Data, NewsAPI, or YouTube API keys were available in the local environment or Cloudflare secret inventory. Do not invent or expose them. Existing keyless sources are used; paid-provider coverage is not claimed. Basketball remains the existing labelled model/demo experience, not a live data feed.

## GitHub deployment

`.github/workflows/azure-deploy.yml` deploys `aidanshamte/Mnemba-Tips` main. It runs existing regression tests and Azure TypeScript checks, builds/pushes an image tagged with the full Git commit, updates the web and all three jobs, then checks real public HTTPS/database routes and uploads the verification artifact. Documentation-only commits do not redeploy.

Authentication uses GitHub OIDC and the user-assigned identity `mnemba-github`; no Azure client secret is stored in GitHub. Client ID: `10f69bfd-aa0b-4ea2-b8ed-1bb43d81c7e7`; tenant: `14b1677f-3a8b-4ca5-b3ce-50d76ab2e4b9`. The federated subject is the repository's actual enhanced subject: `repo:aidanshamte@107291645/Mnemba-Tips@1365963153:ref:refs/heads/main`, issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`.

Permissions are scoped to existing resources: AcrPush on the registry; Container Apps Contributor on `mnemba-web`; Container Apps Jobs Contributor on each update job. The web-app contributor role does not include job deployment permissions. No resource-group-wide contributor access is necessary. This session's GitHub token cannot administer Actions settings or rerun runs; normal pushes trigger the workflow.

## Cost and account actions

Retail prices checked for West US: PostgreSQL B1ms USD 0.022/hour (~16.06/month at 730 hours), 32 GiB storage at USD 0.138/GiB/month (~4.42), ACR Basic ~5.07/month. Allow about USD 4–6 for private networking/DNS, backups and small ancillary usage. Low-traffic estimate: **USD 30–32/month before PostgreSQL student free-service benefits**, or roughly **USD 9–12/month if that benefit applies**. Traffic, egress, logging and execution time can raise this estimate; taxes are excluded.

Container Apps has a shared monthly free allowance of 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests. At 240 seconds each, 33 daily scheduled runs consume about 118,800 vCPU-seconds and 237,600 GiB-seconds per 30 days; web usage shares the remaining allowance. An always-active single web replica plus jobs can bring the total to roughly USD 65–70/month before PostgreSQL benefits. Scale-to-zero reduces idle cost but introduces cold starts.

The verified USD 100 credit covers the current limited deployment, not an unconditional year of hosting. At USD 30–32/month it lasts roughly three months. The USD 10 budget sends alerts; it is not a hard cap. The student subscription's spending limit prevents billing beyond its credit while enabled. Confirm PostgreSQL benefit application and review Azure Cost Analysis once metering arrives; do not upgrade to pay-as-you-go automatically.

Official references: [Azure for Students](https://azure.microsoft.com/en-us/free/students/), [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [retail price API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [managed custom-domain certificates](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).

Namecheap account access is required to enter [these exact records](DNS_SETTINGS.md). Once DNS points to Azure, bind both hostnames and provision managed certificates, then verify HTTPS, redirects, database reads, images and jobs. Keep Cloudflare deployed throughout. A working Azure-generated certificate does not prove custom-domain HTTPS.
