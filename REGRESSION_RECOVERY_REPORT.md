# Fixture browsing recovery — 24 September 2026

## Finding

The suspected LiveScore fixture gate was not present. PostgreSQL, the unfiltered fixtures API and the matchday API all returned **3 fixtures today, 3 tomorrow and 9 for September 24–30 (UTC)**. Direct responses from the already-configured TheSportsDB daily endpoint returned three records for each checked day. Ingestion jobs for fixtures, results, OpenLigaDB and priority imports were successful.

Production still contains 37,625 source records: 36,266 OpenFootball, 1,224 OpenLigaDB, 83 StatsBomb and 52 TheSportsDB. October 10 returns 72 canonical fixtures from OpenFootball/OpenLigaDB. Existing coverage was not deleted or gated on predictions, images, lineups, statistics or LiveScore mapping.

Git history identifies a presentation narrowing in **4b1fd44**, before the LiveScore implementation: the homepage previously passed the broader overview feed to FeaturedMatches; the matchday implementation scoped it to selected-date fixtures/picks. The overview's broader upcoming feed was still fetched but no longer displayed. Current-week source availability and this presentation change are distinct problems.

A separate recent source-refresh defect excluded previously imported files from the hourly refresh after an error changed their state. Production currently has no failed current source with stored fixtures, so this defect is **not established as the cause of today's sparse count**.

## Surgical changes

- Display up to 24 existing upcoming fixtures in a separately labelled section outside the selected date window. Respect competition, team search and status filters; never count these as Today/Tomorrow/Next 7 Days matches.
- Clarify the selected-date total as “matches”; prediction qualification remains a separate count.
- Retry previously imported source files after a one-day error backoff, preserve their fixture records, clear errors on recovery and count successful refreshes correctly.
- Keep existing canonical reconciliation, prediction rules/history, identity components, live worker, database and provider permissions.

## Before and after

| UTC range | Before | After |
|---|---:|---:|
| Today, September 24 | 3 | 3 |
| Tomorrow, September 25 | 3 | 3 |
| Next 7 Days, September 24–30 | 9 | 9 |

The page now also displays **24 separately labelled upcoming matches** for each checked range. Broader browsing is restored; same-day source coverage is not claimed expanded.

## Verification and deployment

- 28 targeted checks passed: fixture union, synthetic LiveScore enrichment, verified same-match deduplication, missing predictions/statistics/lineups/images/mappings, failed-source recovery, local dates, every date preset, DST, live snapshots/SSE, immutable forecasts, consumer queries and existing global coverage.
- Azure TypeScript check and one production application build passed.
- Desktop (1440 px) and mobile (390 px) checks passed locally and in production for Today, Tomorrow, Next 7 Days, the restored upcoming section and basketball. No uncaught browser errors or horizontal overflow.
- Production PostgreSQL rechecked after deployment: all 37,625 provider records and 437 immutable forecast versions remain. Counts match the public APIs.
- Production coverage confirmed: Tanzania 720, EPL 1,520, UCL 560, La Liga 1,140, Bundesliga 3,060, Serie A 1,140, MLS 2,067, J1 1,066. These include historical records, not claims of current fixtures or complete seasons. CAF Champions League has zero imported fixtures.
- One release image deployed to the web app and three existing scheduled jobs: `recovery-20260924`, digest `sha256:9b042a423e8a394c817afb5301fde91f6af5910e0402017c0cf6f3bbef6b5ba8`.
- All three scheduled jobs retain their original cron expressions and `node scripts/azure/job.mjs` commands. New-revision worker startup reports `not-configured`; no live-feed activation is claimed.
- Ready web revision: `mnemba-web--0000012`, https://aidanshamte.me/football . Database health is ready.
- Rollback image retained: `sha256:d3857fb8df980c8089effd3583dd16fe369455c9ecdec220855f495f17a940fa`, prior revision `mnemba-web--0000011`. Durable private backup verified; PostgreSQL seven-day recovery retained. No database reset, historical reimport or migration.
- Operational evidence: `.sites-runtime/regression-recovery/` (ignored, private).

## Remaining limits

The broader acceptance criterion of abundant real fixtures for the current week is **not met** by the currently configured source records. Additional current coverage cannot be manufactured by changing filters. CAF Champions League coverage is absent. LiveScore is still disabled by its existing configuration/contract requirements; the production live endpoint returns an explicit unavailable state. Additive behavior is tested, but a real LiveScore-to-production update cannot be claimed.
