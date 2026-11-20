# Global football coverage — 17 September 2026

This release implements the first requested batch through the existing application, database and Azure jobs. It does **not** establish complete worldwide coverage. The available CC0 files mostly add incomplete historical seasons, not current fixtures. Tunisia has no matching permitted file in the reviewed catalog. Later batches remain deferred until the first batch's current-source gaps are resolved.

## Implementation

- Explicit source-path selection for Egypt, Morocco, South Africa, Algeria, Tunisia, Brazil, Argentina, Liga MX, MLS, Saudi Arabia and J1. Three permitted repository catalogs refresh daily; bounded imports use the existing HTTP cache, retries, provider budgets and job locks. Failed files back off for a day rather than starving other leagues. Existing European fallback selection remains.
- Country and region metadata, stable competition labels, source season labels and calendar/split-year format. A source filename's year no longer establishes that the edition is current. Original provider IDs, match records and saved forecasts remain intact.
- Country-aware display grouping avoids merging identically named domestic leagues. J1 generated JSON/source mirrors reconcile only exact teams and round within the documented source season; both underlying records remain.
- Public `/football/coverage` reports actual imported results, upcoming fixtures, exact kickoffs, saved previews, tracked/graded forecasts and badge counts. Zero-record targets appear as source gaps, not covered league tiles. The competition picker supports region and country; catalog choices require imported fixtures.
- The parser strips postponed/cancelled annotations from participant names while retaining existing fixture IDs, and distinguishes shootout scores from the pre-shootout match score and preserves postponed/cancelled statuses. Regulation-time grading is withheld when a penalty/extra-time result does not establish the 90-minute score.
- Date-only fixtures remain exploratory, never invented exact kickoffs. Existing temporal evidence, saved prediction history, regulation-time grading, chronological model promotion gates and basketball experience remain. No model was promoted and no accuracy improvement is claimed.

## Source review and costs

Checked 17 September 2026. No paid subscription was purchased.

| Provider | Cost / documented limit | Actual use and restrictions |
|---|---|---|
| [OpenFootball](https://github.com/openfootball/world) | $0; CC0 | Imported files through the existing pipeline. Local ceiling 250 requests/day; conditional requests and GitHub rate-reset backoff. Repository catalogs refreshed daily. Files have no guaranteed freshness, complete results or verified timezone. Historical depth is the published files, not a promised API window. |
| [TheSportsDB](https://www.thesportsdb.com/docs_pricing.php) | Free $0, 30/min; developer $9/month, 100/min; business $20/month, 120/min | Existing metadata/day feed preserved, local ceiling 240/day. No new image-rights claims. [Terms](https://www.thesportsdb.com/docs_terms_of_use.php) require checking each image's actual creator/source/license; a Creative Commons flag alone is insufficient. Unknown artwork is not cleared for public use. No additional badges were imported by this batch. |
| [API-Football](https://www.api-football.com/) | Free 100/day with season restrictions; Pro $19/month, 7,500/day; Ultra $29/month, 75,000/day | Existing integration remains credential-dependent. Current first-batch coverage and plan entitlement have not been demonstrated. No key supplied or subscription purchased. Local automatic ceiling remains 96/day. |
| [Football-Data.org](https://www.football-data.org/pricing) | Free €0, 12 competitions, delayed schedules/scores, 10/min; live €12/month; Standard €49/month for 30 competitions | Existing integration remains credential-dependent. Free coverage does not imply the requested African leagues are available. No subscription purchased. |
| Wikidata / Wikimedia Commons | $0 | Existing identity/media pipeline retained. Structured Wikidata facts are CC0; Commons assets need individual license/attribution verification. No new artwork was copied. |
| StatsBomb Open Data | $0 | Existing historical analysis retained with attribution; no new current fixture coverage claimed. |

The first-batch import uses OpenFootball, costing $0 in data-provider subscriptions. Existing Azure hosting charges continue; this release does not change plans or provision paid resources.

## Current editions and limitations

The [Egyptian league's official site](https://www.egyptianproleague.com/league) lists the 2026/27 ORA league draw; the imported Egyptian file is 2024/25 and cannot establish its current participants/rules. [PSL](https://www.psl.co.za/news/article/5615294-psl-confirms-the-202627-season-calend) identifies the 2026/27 Betway Premiership calendar; the imported South African file remains 2024/25.

[J.League's official decision](https://www.jleague.jp/news/article/26796/) transitions the league to a 2026/27 split-year season. Its separate 2026 Hundred Year Vision competition must not be treated as an ordinary 2026 calendar season. This import only establishes published 2025 history. No 2026/27 J1 schedule or participant completeness is claimed.

[Algerian LFP](https://lfp.dz/fr/calendar) and [Tunisian FTF](https://www.ftf.org.tn/fr/ligue-i/) provide official verification pages, but no permitted current ingestion feed was established here. Current Morocco, Argentina, Mexico, MLS and Saudi season participants/rules remain unverified by this batch. Stage labels such as Apertura, Clausura, playoffs, championship and relegation are preserved from source records; generic reconstructed tables are explicitly not official standings and do not implement competition-specific tie-breaks.

No restricted site was scraped. Official pages were used for verification, not copied into a fixture database. Missing current schedules, lineups, injuries, player statistics and live scores remain explicit limitations. Old uncompleted schedules are not converted into results or counted as upcoming.

## Preservation and verification

Both existing SQLite databases were backed up before imports and again after the batch. Azure's B1ms tier does not support customer-triggered physical backups. A bounded-memory, repeatable-read logical export of football tables was therefore uploaded to the existing private `migration-backups` container, downloaded and parsed, with SHA-256 verification. The export contains 14,414 fixtures, 3,176 exploratory estimates and 97,445 evidence claims at 16:00 UTC. It excludes credentials and user tables. Production schema migrations were unnecessary.

Backup SHA-256: `df5d045318cced8154f60ed4c59b5f58e549de55ccb5ffd7e2903c154864c8d1` (verified against the downloaded private export).

All 27 unit/system/Azure test files passed. A PostgreSQL 17 restore independently validated every table's count and content checksum; real PostgreSQL tests passed for public reads, immutable history, transactions, concurrent quotas and scheduler locks. Standard and Azure TypeScript checks and the Azure Docker build passed. Chromium passed desktop/mobile coverage and country/region selection, plus existing fixtures, search, matches, prediction history, news, profiles and basketball scenarios.

Operational evidence is kept in `.sites-runtime/global-coverage/`; exports and secrets are excluded from Git. Cloudflare and its records are preserved. Production verification and exact league counts are recorded below.

## Production verification — 2026-09-17T16:31:17.835Z

The web app and all three scheduled update jobs use `global-20260917-1607`. Ready web revision: `mnemba-web--0000008`. Canonical HTTPS health/database checks and public route checks pass; anonymous diagnostics return 403. DNS requires no further changes.

The first-batch importer was invoked through the deployed application. Overlapping attempts reported the existing synchronization lock and skipped work; no lock or provider quota was bypassed. The public endpoint independently confirms these imported counts at the time above:

| Competition | Fixtures | Results | Upcoming | Saved previews |
|---|---:|---:|---:|---:|
| Argentine Primera División | 240 | 240 | 0 | 0 |
| Tunisian Ligue Professionnelle 1 | 0 | 0 | 0 | 0 |
| Algerian Ligue 1 | 240 | 160 | 0 | 0 |
| South African Premier Division | 240 | 189 | 0 | 0 |
| Botola Pro | 200 | 200 | 0 | 0 |
| Egyptian Premier League | 225 | 183 | 0 | 0 |
| J1 League | 380 | 136 | 0 | 244 |
| Campeonato Brasileiro Série A | 760 | 636 | 110 | 124 |
| Major League Soccer | 513 | 167 | 0 | 0 |
| Liga MX | 340 | 340 | 0 | 0 |
| Saudi Pro League | 306 | 267 | 0 | 39 |

Counts describe imported records, not complete seasons. Tunisia remains without imported fixtures. All first-batch tracked and graded forecast counts remain zero; date-only schedules do not establish exact upcoming kickoffs. These gaps remain visible on the public coverage page.

Chromium passed coverage and region/country selection at 1440px and 390px, along with the full existing football/basketball suite. Saved-preview acceptance passed eight match checks and six decoded badge checks with zero page errors. All 27 test files and both TypeScript checks pass in the final workspace; the final run did not configure a live PostgreSQL test database, so the earlier restore/integration evidence remains the database verification. Existing lint debt remains.

Final evidence: `.sites-runtime/global-coverage/production-coverage-final.json`, `url-final.json`, `tests-wrapup.log`, `browser-production/`, `browser-production-regression/` and `browser-production-usefulness/`. Cloudflare and existing records remain preserved.
