# Source ingestion recovery — 24 September 2026 UTC

## Findings supported by production and Git history

The previous three-day public TheSportsDB horizon accounts for the 3 / 3 / 9 current inventory. Its actual response has three fixtures per date. OpenFootball and OpenLigaDB retain thousands of future records, but neither supplied matches for September 24–30 in the production snapshot. Current-season inventory includes 2026/27 OpenFootball and calendar start-year 2026 OpenLigaDB (with older seasons retained); OpenFootball refresh rotates across older and current files.

Neither API_FOOTBALL_KEY nor FOOTBALL_DATA_KEY exists on the production web app or fixture job. Their registry has no previous attempts; migration evidence also records them absent. No evidence establishes that LiveScore removed them. The earliest relevant Git version already selected one keyed provider with the other as fallback and queried only three TheSportsDB dates. The repair changes configured keyed sources to a union and expands the rolling window to seven UTC dates within existing quotas.

The apparent September 20 spike includes 247 Belgian 2026/27 records. The upstream file marks rounds 8–34 `(datum TBC)`; the old parser carried September 20 forward into those undated rounds. The corrected parser accepts 63 of 306 source matches and rejects 243 without verified dates; only four legitimate Belgian fixtures remain on September 20. This is evidence against treating that historical spike as established worldwide daily coverage. Existing historical rows were not deleted or broadly reimported.

Highlightly and Sportmonks are disabled registry candidates without implemented adapters; StatsBomb supplies historical records. LiveScore remains optional and additive. There is no evidence that canonicalization reduced hundreds of current returned fixtures to nine: the public date endpoint returned nine and persisted nine.

Hourly Azure executions before repair failed with container exit 137 after fixture/result subtasks; the precise kill cause is not established. OpenLigaDB uses the separate three-hour job. Successful fixture subtasks must not be described as successful complete scheduled executions.

## Changes

- `service.mjs`: combine both configured keyed providers, isolate failures, request seven-day horizon, expose normalization counts and quota-aware daily markers.
- `adapters.mjs`: count public source raw/rejected rows; prevent undated round date carryover.
- `fixture-ingestion.mjs`, `store.mjs`, `intelligence.mjs`, `openligadb.mjs`: fixture-only counters, provider reasons, persisted seven-day inventory and relative decline health; skip expensive forecast regrading for unchanged schedules.
- `scheduled.mjs`: classify degraded ingestion as partial instead of healthy.
- `intelligence-workspace.tsx`: remove the separate 24-upcoming workaround; retain canonical date browser.

No ML, logo, basketball, or architecture redesign; no broad historical import or database wipe.

## Verification before deployment

39 targeted regression tests passed across ingestion health, fixture breadth, edge cases, global coverage, worldwide, live, and lifecycle. An additional isolated PostgreSQL regression passed. Azure TypeScript and production build passed. Standalone desktop/mobile browser checks passed for Today/Tomorrow/Next 7 Days, main-card counts, no separate upcoming section, prediction link, and basketball. Local browser checks used production API responses; live stream transport was excluded from that local proxy check.

Release: `mnembab55deec1.azurecr.io/mnemba@sha256:c97a3942146da91f7af0b13c213189dfa68d1d3c91de49763016ba76d2ff6986`. One release deployment updates web and the three existing scheduled jobs. Rollback metadata and protected diagnostic evidence are in `.sites-runtime/ingestion-recovery/`.

## Acceptance limitation

Broad worldwide current inventory is not established by the available public sources. Missing keyed-provider configuration remains a blocker, not proof that supplying credentials alone guarantees complete coverage. No artificial target or fabricated fixtures were used. Production after-deployment measurements follow below.

## Production result

Ready revision `mnemba-web--0000013`; verified https://aidanshamte.me/football. Actual execution `mnemba-update-0-00zb8zf` pulled the release digest and entered `job.mjs` → `runScheduled` → fixture/result sync. The fixture report persisted at 15:34:25 UTC: 578 raw, 578 normalized, 0 rejected, 0 batch duplicates, 12 inserted, 0 updated, 566 confirmed unchanged. Health is **degraded**, correctly reflecting only one provider in the current seven-day inventory. The OpenFootball refresh selected an older-season file (`2025-26/en.2.json`) in the existing rotation; those 557 unchanged records supplied no current breadth. Current-season files were already present, but this rotation is not proof of a current worldwide feed.

| Provider | Raw this fixture run | Accepted | Persisted/confirmed | Current seven days / future source rows |
|---|---:|---:|---:|---:|
| OpenFootball | 557 | 557 | 557 unchanged | 0 / 4,000 |
| TheSportsDB | 21 | 21 | 21 (12 new) | 21 / 21 |
| OpenLigaDB | 0 (separate job) | 0 | 0 this run | 0 / 522 |
| API-Football | 0 | 0 | 0 | 0 / 0 |
| football-data.org | 0 | 0 | 0 | 0 / 0 |
| LiveScore | 0 | 0 | 0 | 0 / 0 |
| Highlightly | 0 | 0 | 0 | 0 / 0 |
| Sportmonks | 0 | 0 | 0 | 0 / 0 |
| StatsBomb | 0 (historical only) | 0 | 0 this run | 0 / 0 |

Provider future source rows use starts_at from UTC September 24 and can overlap. They must not be summed as canonical unique scheduled inventory. The health query instead counts unique canonical IDs with future scheduled status: **3,941**. Current UTC date browser/API counts: Today **3**, Tomorrow **3**, September 24–30 **21** (before: 9). Total source rows **37,637**, total canonical fixture IDs **36,265**. October 10 still shows 72 deduplicated matches from OpenFootball and OpenLigaDB. All current fixtures remain visible despite no eligible prediction or LiveScore enrichment.

Post-ingestion desktop and mobile browser checks passed with 3/3/21 in the main list, no extra upcoming region, no page errors, and working basketball. Public API counts equal direct database-backed canonical fixture queries. Health endpoint is protected by the existing internal token; secrets were handled only in memory.

**Scheduler limitation:** Azure marked the full execution Failed. System logs establish exit 137 / ProcessExited at 15:34:35, after both ingestion health records and before the final cron summary. The exact cause is not established; do not label it an OOM or a successful full run. No ML changes or second deployment were made. Existing schedules and image updates remain configured independently of Codespaces. Fixture retries remain due on the existing cadence even when health is degraded.

**Outstanding:** worldwide current breadth is not restored, API_FOOTBALL_KEY and FOOTBALL_DATA_KEY are absent, and the later scheduled processing termination remains unresolved. This report does not assert acceptance completion. The undated historical Belgian records remain in the existing database; the parser fix prevents future acceptance of their unverified dates.

Prediction archive smoke check passed: first page returned 20 matches with 21 archived forecast versions and a next page. This verifies archive accessibility, not a post-deployment recount of all 437 previously recorded versions; Azure console rate limiting prevented that final recount.
