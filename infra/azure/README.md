# Mnemba Tips Azure migration

Status: local rehearsal only. No Azure subscription is authenticated; no Azure resources or DNS records have been changed. Production D1 export is awaiting explicit account/destination confirmation after automatic approval review rejected it. Do not describe local verification as an Azure migration.

## Account actions

Azure CLI was installed in `/tmp/mnemba-azure-cli`. Sign in interactively (do not paste credentials into chat):

```bash
export AZURE_CONFIG_DIR=/workspaces/Mnemba-Tips/.sites-runtime/azure-cli
export PATH=/tmp/mnemba-azure-cli/bin:$PATH
az login --use-device-code
az account list --query '[].{name:name,id:id,state:state}' -o table
```

Select the Azure for Students subscription, not Students Starter. Set `AZURE_SUBSCRIPTION_ID` and `AZURE_LOCATION`, then run `bash scripts/azure/preflight.sh`. Inspect allowed-location policies, available B1ms capacity, Microsoft.App quota, provider registrations, role-assignment permission, remaining credit and expiry. No tenant-specific limits have yet been verified. Register missing providers only after selecting the subscription. Deployment needs Contributor plus permission to assign AcrPull (Owner or User Access Administrator).

Azure for Students generally provides $100 for 12 months, subject to eligibility and spending limits. PostgreSQL's 750 B1ms hours + 32 GB data + 32 GB backup free allowance must be confirmed for this subscription, not assumed. See [student offer](https://azure.microsoft.com/en-us/free/students/), [offer conditions](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/), and [credit expiry](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/azurestudents-subscription-disabled).

## Exact proposed infrastructure

`main.bicep` is the source of truth; names default to prefix `mnemba`. Region and globally unique PostgreSQL/ACR names must be selected after account checks.

| Resource | Settings |
|---|---|
| Resource group | `mnemba-azure`, selected eligible region |
| Web app | `mnemba-web`, Consumption, 0.5 vCPU / 1 GiB, 0–1 replicas, HTTP concurrency 20 |
| Ingress | External HTTPS only, container port 3000, Azure-generated hostname |
| Readiness | `/api/health`, 15-second interval, 5-second timeout |
| Liveness/startup | TCP port 3000; startup allowance 150 seconds |
| PostgreSQL | Version 17, Burstable Standard_B1ms, 32 GiB, autogrow disabled, 7-day backup, no HA |
| Database | `mnemba`; selected verified snapshot schema through `MNEMBA_DATABASE_SCHEMA` |
| Network | `10.42.0.0/16`; ACA subnet `10.42.0.0/23`; PostgreSQL `10.42.2.0/28`; delegated private DB access; public DB access disabled |
| Private DNS | `mnemba.postgres.database.azure.com`, VNet linked |
| Registry | Basic, admin login disabled, user-assigned identity with AcrPull |
| Logging | No paid Log Analytics ingestion; platform log streaming and database cron records; revisit retention before production |
| Scheduled jobs | `mnemba-update-0/1/2`, 0.5 vCPU / 1 GiB, parallelism 1, timeout 300 seconds, retry 0 |
| Job schedules UTC | `0 * * * *`, `20 */3 * * *`, `40 3 * * *` |
| Staging guards | `enableUpdates=false`, jobs Manual, POST updates blocked, `MNEMBA_ENABLE_UPDATES=0` |

PostgreSQL connections verify TLS certificates. The bootstrap template uses the database administrator connection in an ACA secret; before public production, create separate least-privilege runtime/job roles and replace this secret. Provider keys and internal authorization token must be transferred into ACA secrets, never Docker build arguments, source files, logs or public outputs. Existing keys are deliberately not copied by this work.

## Build and infrastructure preparation

```bash
docker build -f Dockerfile.azure -t mnemba-azure:rehearsal .
az bicep build --file infra/azure/main.bicep --outfile /tmp/mnemba-azure-main.json
```

The Docker build uses the existing app with Next standalone output. The Cloudflare/Vinext build remains available. Credentials, local state and database files are excluded by `.dockerignore`.

Create a **mode-0600 ignored** ARM parameters file with `location`, `postgresName`, `registryName`, a generated strong `postgresPassword`, and initially `deployRuntime=false`. Pass it as `--parameters @FILE`, never password command arguments. Run `az deployment group what-if` and `validate` before `create`. Bicep compilation has passed; Azure validation has not run because no subscription is signed in. Keep runtime disabled until schema import is verified. Push the tested image to the private registry using interactive/managed Azure credentials, then set `deployRuntime=true`, `databaseSchema` to the verified schema, and keep `enableUpdates=false`.

Private PostgreSQL cannot be imported directly from this Codespace without an authorized private network path. Run the importer inside the ACA environment (a manual migration job or private network runner). Supply the snapshot through a private, encrypted, temporary storage location with narrowly scoped access. Do not include snapshots in the public web image. This private transfer and manual migration job still need provisioning after account access and backup authorization.

## Backup and migration workflow

Local SQLite backups and SHA256/count manifests are under `.sites-runtime/azure-migration/` and `.sites-runtime/backups/`, ignored by Git. Two existing local databases were backed up through SQLite's online backup API, so WAL contents are included. Both passed integrity and foreign-key checks. Store a second encrypted copy outside this workspace before cutover; workspace-local copies alone are not disaster recovery.

After remote-backup authorization, export production D1 to a unique filename using `wrangler d1 export mnemba-tips-db --remote --config wrangler.jsonc --output FILE.sql`. Exporting is read-only, but the backup contains application data and must remain private. Restore to a **new** SQLite file:

```bash
python scripts/azure/restore-d1-export.py REMOTE.sql REMOTE.sqlite
node scripts/azure/compare-snapshots.mjs LOCAL.sqlite REMOTE.sqlite REPORT.json
```

Do not replace production with the larger local database. Preserve both snapshots, compare all primary keys, and explicitly resolve conflicting values and immutable historical records. Import separate schemas first. The comparison script reports conflicts without changing either source. Apply missing versioned schema migrations only to a working copy of a snapshot, retaining the raw original.

Set `DATABASE_URL` securely and run:

```bash
node scripts/azure/migrate.mjs SNAPSHOT.sqlite NEW_SCHEMA MANIFEST.json
node scripts/azure/verify-counts.mjs MANIFEST.json
```

The importer requires a new schema; it never truncates or overwrites one. All imports and validation run in one transaction. It copies application tables, keys, indexes, foreign keys and immutable triggers. Integer timestamps use BIGINT; fractional player minutes remain floating point; audit row insertion order is explicitly preserved. It compares per-table counts and content hashes before commit. Cloudflare metadata and D1 migration bookkeeping remain in original backups, not in PostgreSQL application tables. Unknown triggers, cyclic references, invalid source data or hash mismatches abort rather than discard rows.

A local PostgreSQL custom-format dump has been restored into a separate database and checked. For Azure, obtain a verified `pg_dump` and confirm managed point-in-time restore retention. Store backups outside the primary resource group.

## Verification and final synchronization

```bash
DATABASE_URL=... MNEMBA_DATABASE_SCHEMA=... npm run test:azure
node scripts/azure/verify-url.mjs https://AZURE-FQDN.azurecontainerapps.io REPORT.json
PLAYWRIGHT_MODULE=playwright node scripts/azure/browser.mjs https://AZURE-FQDN.azurecontainerapps.io
```

Do not put actual credentials in shell history when setting environment variables. Integration tests are for isolated rehearsal databases: they write and clean up test leases, quota rows and scheduler runs. Scheduler integration stubs provider network work; it does not prove live feed success. The test URL scripts perform public reads only.

The current checkout has **no public basketball journey**: `/lab` redirects to `/football`; its basketball demo component and model tests remain. Do not report basketball end-to-end acceptance as passed. Decide the intended basketball route before release.

Keep Cloudflare serving throughout staging. Before final import, pause production writers/scheduler briefly while serving cached reads, take a fresh D1 export, reconcile all changes, verify again, and only then activate the single Azure writer. Do not run two independent quota ledgers against the same provider keys. Rollback after Azure writes requires replaying those new writes to D1, not merely changing DNS.

## DNS and TLS — no changes made

Observed on 2026-09-17: `aidanshamte.me` and `www.aidanshamte.me` resolve to GitHub Pages (`185.199.108.153` through `185.199.111.153`), and apex TLS hostname validation fails from this environment. Cloudflare Worker `https://mnemba-tips.kaidan547.workers.dev` returns HTTPS 200 and database ready. Cloudflare account metadata lists no Worker custom domains. Reconcile actual DNS ownership/current routing before any cutover.

First prove HTTPS, database, real fixture/player/team/news journeys, and scheduler on the Azure-generated hostname. Actual Azure hostname/IP/verification ID do not exist yet and must not be invented. The Bicep outputs provide `azureUrl`, `apexIp`, and `domainVerificationId` after deployment.

Future records, **only after acceptance**:

| Type | Name | Value |
|---|---|---|
| A | `@` | Bicep `apexIp` (Container Apps environment static IP) |
| TXT | `asuid` | Bicep `domainVerificationId` |
| CNAME | `www` | Host portion of Bicep `azureUrl`, if www is desired |
| TXT | `asuid.www` | Same verification ID for www binding |

Use DNS-only records during Azure managed-certificate validation; preserve the previous exact records and TTL for rollback. Azure's generated domain already has HTTPS. For zero-gap custom-domain HTTPS, pre-bind a valid imported certificate obtained through DNS validation before routing traffic, or explicitly plan the Azure managed-certificate issuance transition. Do not assume the Azure-generated certificate covers `aidanshamte.me`. See [Azure custom domain and managed certificate requirements](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates). DNS must remain unchanged until Azure-generated HTTPS and journeys pass.

## Expected costs (USD; East US illustration, not a subscription quote)

Public Azure Retail Prices API checked 2026-09-17: B1ms $0.017/hour × 730 = $12.41; 32 GiB PostgreSQL storage × $0.115 = $3.68; Basic ACR $0.1666/day ≈ $5.07/month. Allow roughly $4–6 for private DNS/public IPv4 and incidental networking, subject to actual metering. A low-traffic scale-to-zero setup is roughly **$25–30/month before student/free-service benefits**, excluding outbound bandwidth, excess backup and build consumption. If the PostgreSQL free allowance applies, roughly **$9–14/month** remains. Budget conservatively and check actual usage.

ACA monthly grant: 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests shared across this subscription. Active rates: $0.000024/vCPU-second and $0.000003/GiB-second; requests beyond grant $0.40/million. A continuously active 0.5 vCPU / 1 GiB web replica costs about **$34/month after compute grants**, plus jobs and infrastructure. The three schedules launch 33 times/day; at 240 seconds each they consume about 118,800 vCPU-seconds and 237,600 GiB-seconds in 30 days, sharing that grant. Budget around **$60–70/month** for sustained activity, more with egress or other services. $100 student credit does not guarantee a year of operation. Budget alerts (for example $10/$25/$50) are alerts, not spending caps. Keep the student spending limit enabled.

Sources: [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), [scheduled jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs).
