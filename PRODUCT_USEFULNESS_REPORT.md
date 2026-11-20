# Product usefulness — implementation and verification

## Observed root causes (17 September 2026)

Production read-only audit: 11,807 fixture records, 1,914 exploratory estimates, zero tracked forecasts and grades, 814 teams, 227 players, 27 media assets and 29 links. Media queue: 884 pending, 38 failed, 38 skipped, 25 verified. Protected raw evidence is in `.sites-runtime/useful-product/`.

- `savedEstimate` required an exact revision hash on public reads. The hash included display-only fixture decorations; background jobs used raw fixtures while public pages added lifecycle fields, so even unchanged evidence could never match. A saved exploratory preview therefore disappeared after evidence changes even though the archive still displayed it. Goal markets disappeared with the same payload.
- Date-only fixture capture deliberately abstains from tracked forecasting. This is correct: a calendar placeholder is not a verified kickoff. The model job saves exploratory previews with actual creation times instead.
- Model batches began at timestamp zero and scanned old scheduled records before current fixtures, processing only 50 per hourly run. Production's latest observed batch saved 50 exploratory records without completing the batch.
- All three Azure jobs have actual successful executions, following earlier failures. Database `cron_runs` confirms fixture updates, exploratory writes, snapshots, roster writes and search indexing. This does not establish tracked forecasting or grading in production: both counts are zero.
- Badge import hard-coded five leagues. Media enrichment processed four entities per invocation, was absent from all cron schedules, and overlooked Wikidata IDs on entity payloads. The browser suite explicitly accepted monogram fallbacks as its team visual check.

## Implemented changes

Saved previews remain visible with original timestamps and explicit refresh/history labels. They retain goal markets but cannot become current recommendations while stale. Exploratory history survives live and finished statuses. Immutable tracked history and chronological promotion gates remain intact. Upcoming model batches start on today's calendar date and process upcoming fixtures in date order, including later schedules.

Existing schedules now include bounded media work, rotating badge discovery and priority imports. Discovery cycles through persisted SportsDB competitions, preserving earlier results, and accepts exact verified provider links or unique country-checked names. Missing badges and portraits use full names. Match cards lead with probabilities, the strongest result, reasons, risks and calculation time.

Two local SQLite backups were created before work. No schema migration, database replacement, Azure plan change, new paid resource or Cloudflare deployment is required.

Local verification and production acceptance results are recorded below; source limitations remain explicit.

## Local execution evidence

- Both SQLite databases were backed up under `.sites-runtime/backups/`. The active database contained 11,795 fixtures and 1,663 previews. Exercising the revised model job saved 47 previews (1,710 total), abstained on three matches and reported zero errors. All 3,603 future fixtures in that snapshot were date-only; tracked forecasts and grades remain zero.
- All 26 unit/system/Azure test files pass, including immutable forecast lifecycle, result corrections, verified regulation grading, timed conversion, chronological evaluation, scheduler locks/deadlines/batch draining, changed evidence, revision normalization, country/identity collisions and rotating league discovery. Standard and Azure TypeScript checks pass.
- Azure production Docker builds pass. A PostgreSQL 17 container restored the existing 11,795-fixture snapshot without touching production. Desktop/mobile journeys passed for football, fixtures, search, match history, news, profiles and basketball scenario selection.
- Additional match journeys exercised Betis–Getafe plus three independently selected saved/completed fixtures at 1440px and 390px. Betis–Getafe displays the preserved 59.2% / 24.0% / 16.8% estimate. Six independent image checks decoded genuine badges; no page errors were observed. Fallback layout results are recorded separately and do not count as loaded images.

## Production acceptance — 17 September 2026

Verified `https://aidanshamte.me` on release `global-20260917-1607`, ready revision `mnemba-web--0000008`. All three scheduled update jobs use the same image. Public health reports the database ready; protected diagnostics remain forbidden to anonymous requests.

Desktop/mobile football, fixtures, team/player search, match pages, prediction history, news, profiles and basketball scenarios passed. The production usefulness suite passed eight match checks and six decoded badge checks, with zero failed images or page errors. Coverage region/country discovery also passed at both widths. Evidence: `.sites-runtime/global-coverage/browser-production-regression/`, `browser-production-usefulness/`, `browser-production/` and `url-final.json`.

All 27 unit/system/Azure test files and both TypeScript configurations pass in the final workspace. The first test attempt exposed a broken local `pg` link into temporary storage; restoring the declared dependency resolved it. This final run did not supply `DATABASE_URL`, so real PostgreSQL integration verification is the earlier recorded restore run, not a newly executed database test. Existing lint debt and provider coverage limitations remain.
