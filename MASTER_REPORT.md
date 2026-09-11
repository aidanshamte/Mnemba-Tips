# PitchPredict master implementation checkpoint

Local URL: http://127.0.0.1:8787/football. Start with `pnpm start`; rebuild with `pnpm build`. Basketball remains at `/lab` with an explicit Demo Data label. Existing credentials were preserved. There is no Git metadata in this workspace; changed files are compared with `.sites-runtime/source-before-master-checkpoint.zip`.

## Verified repairs and experience

- Imported Bundesliga 2025-26 through 2022-23 (1,224 historical fixtures). Fixed clock/half-time contamination in the score-between-teams parser, repaired 306 records in place, and removed 210 unused malformed participants while preserving fixture IDs and evidence revisions.
- Required Frankfurt 1-4 Augsburg fixture on 6 September 2026: two consolidated source records, eight earlier H2H meetings, ten-match form for each team and an 18-team derived table. The analyzed result is excluded. Kickoff timezone remains explicitly unverified; no retrospective original prediction is fabricated.
- Broadcast-style real-data hero, score wire, responsive match center, internal attributed news briefings, competition/team/player pages, database search, administrator controls and model-performance page.
- Verified Augsburg and Frankfurt Wikidata club mappings and aliases. Opaque profile route tokens eliminate double encoding. Real API queries FC Augsburg, FCA, Augsbrg and Eintracht Frankfurt put the relevant club first; Bundesliga returns four competition records. Search supports typo tolerance, filtering, keyboard navigation, recent queries and pagination.
- Imported 115 Wikidata membership records. These may include historical associations and are explicitly not confirmed squads. Imported StatsBomb women?s match 4020846 team sheets/events/statistics with 31 recorded participants; minutes derive from recorded position intervals and the observed final whistle. No player ratings are invented.
- Probable XI estimates require at least three prior recorded team sheets known before cutoff and complete positional evidence; otherwise they abstain. Current membership alone cannot generate an XI.
- Jobs distinguish inserted, updated, duplicate, failed and source errors. Administrator disables persist across initialization. Empty/partial responses retain cached data and expose their outcome.

## Database and sources

Applied additive migrations `0003_football_search.sql` (verified aliases and indexed search) and `0004_football_forecasts.sql` (immutable prospective forecasts, grading and model parameters), on top of existing migrations. Migration reproduction/idempotence tests pass. SQLite quick check is OK; foreign-key violations: zero.

Latest audit: `outputs/master-current-audit.json`. At 2026-09-11 04:39 UTC: 28 competition records, 607 teams, 180 player records, 143 news records, 39,213 evidence claims, 6,355 indexed documents. 5,334 source fixture records consolidate to 5,062 fixtures:

| Source | Fixture records |
|---|---:|
| OpenFootball | 5,239 |
| StatsBomb | 83 |
| TheSportsDB | 12 |

Keyless imports succeeded for OpenFootball, Wikidata, TheSportsDB local development API, StatsBomb, BBC and Guardian permitted feed metadata. Archive availability returned HTTP 429 and remains in backoff. TheSportsDB public development access is not a production redistribution license.

Optional free credentials: API_FOOTBALL_KEY, FOOTBALL_DATA_KEY, YOUTUBE_API_KEY. No account is necessary to use the current keyless system.

FIFA/UEFA/confederation page ingestion and Instagram/Facebook/X/TikTok, Soccerway, WorldFootball, FootyStats, Flashscore, LiveScore, SofaScore and Transfermarkt automated collection remain disabled: reviewed automation/storage authorization and supported endpoints are not configured. External verification links remain available. Missing credentials disable their corresponding optional API adapters. No bypass or disguised copying was used.

## Models and validation

The original baseline uses Elo, weighted form/scoring and Poisson score probabilities. Dixon-Coles is a separate research candidate with recency-weighted dependence fitting. Three competition candidates were fitted from training-permitted results; the Bundesliga fit used 936 known results with rho -0.06 at fitting time. Later imported history does not retroactively change that saved fit.

Prospective immutable forecasts support grading, accuracy, Brier, log loss, ranked probability score, reliability bins and competition breakdowns. No held-out measured accuracy is claimed: currently zero eligible persisted forecasts/grades, with 85 date/coverage abstentions during the recorded model run. One authentic snapshot and 118 missed horizons are stored; missed past horizons are never backfilled. Date-only schedules cannot enter graded forecasting. Candidate fitting is not validation or calibration evidence.

66 automated tests passed (29 unit, 37 system), covering migrations, provider contracts, deduplication, provenance, quotas, scheduler behavior, leakage, calibration, models, search, participant normalization and lineup evidence. TypeScript passed. Production build passed before the last small responsive-filter/heading adjustment; final rebuild verification is being recorded in MASTER_PROGRESS.md.

Desktop/tablet/mobile Chrome checks passed: football views, search/profile, internal news, model/admin routes, historical match details, overflow and basketball interaction. External traffic and synchronization are mocked in browser tests. Separately, the real local Refresh Match Intelligence API completed successfully, imported 306 Bundesliga 2022-23 results, refreshed both membership sets and returned enriched context (`outputs/final-enrichment.json`).

Screenshots: `outputs/football-desktop.png`, `outputs/football-mobile.png`, `outputs/match-desktop.png`, `outputs/match-tablet.png`, `outputs/match-mobile.png`. Desktop/mobile screenshots were visually inspected.

## Remaining acceptance work and source limitations

This is a working checkpoint, not a claim that every master-mandate feature is complete. Generic permitted ICS/sitemap/JSON-LD discovery lifecycle and optional official search API discovery remain engineering work. Administrator mapping-resolution workflow and exhaustive accessibility/offline-state acceptance remain incomplete. Global identity reconciliation is conservative rather than comprehensive. Many discovered historical files remain queued for incremental import.

Coverage limitations: sparse verified current lineups/injuries, incomplete worldwide fixtures, unresolved timezone claims and no authentic graded forecast dataset yet. These cannot be filled with invented data. Optional accounts may improve coverage but do not guarantee every competition or field.

Personal actions needed for the keyless application: none. Optional API credentials require the user's own account registration. Enabling collection from currently unreviewed providers requires actual permission evidence.

## Changed implementation files

- `app/intelligence.css`
- `app/lab/page.tsx`
- `app/football/admin/page.tsx`
- `app/football/predictions/page.tsx`
- `app/football/search/page.tsx`
- `app/football/news/[id]/page.tsx`
- `app/football/match/[id]/page.tsx`
- `app/football/competition/[id]/page.tsx`
- `app/api/intelligence/route.ts`
- `components/admin-controls.tsx`
- `components/competition-center.tsx`
- `components/entity-explorer.tsx`
- `components/featured-matches.tsx`
- `components/football-entity.tsx`
- `components/global-search.tsx`
- `components/intelligence-workspace.tsx`
- `components/match-center.tsx`
- `components/model-performance.tsx`
- `components/news-briefing.tsx`
- `components/original-analysis.tsx`
- `lib/football/adapters.mjs`
- `lib/football/consumer.mjs`
- `lib/football/dixon-coles.mjs`
- `lib/football/entity-context.mjs`
- `lib/football/history.mjs`
- `lib/football/intelligence.mjs`
- `lib/football/model-lab.mjs`
- `lib/football/probable-lineup.mjs`
- `lib/football/provenance.mjs`
- `lib/football/schema-v3.mjs`
- `lib/football/schema-v4.mjs`
- `lib/football/search.mjs`
- `lib/football/service.mjs`
- `lib/football/source-registry.mjs`
- `lib/football/statsbomb-lineups.mjs`
- `lib/football/store.mjs`
- `lib/football/temporal.mjs`
- `scripts/browser-smoke.mjs`
- `scripts/repair-bundesliga-participants.mjs`
- `scripts/update-local.mjs`
- `scripts/verify-wikidata-aliases.mjs`
- `tests/system/consumer.test.mjs`
- `tests/system/dixon-coles.test.mjs`
- `tests/system/job-outcomes.test.mjs`
- `tests/system/model-lab.test.mjs`
- `tests/system/probable-lineup.test.mjs`
- `tests/system/search.test.mjs`
- `tests/system/statsbomb-lineups.test.mjs`
- `drizzle/0003_football_search.sql`
- `drizzle/0004_football_forecasts.sql`
