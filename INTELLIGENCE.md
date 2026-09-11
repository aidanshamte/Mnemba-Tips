# Global football intelligence

The production application runs at **http://127.0.0.1:8787**. `/` and `/football` open the new football desk. `/lab` preserves the original football/basketball scenarios; `/football/classic` preserves the advanced workspace. Match pages include original analysis, entity links, provenance and immutable snapshot panels.

## Local commands

```powershell
pnpm build
pnpm start
pnpm sync bootstrap
pnpm sync fixtures
pnpm sync hourly
pnpm sync daily
pnpm backup
node scripts/import-featured.mjs
pnpm tasks:install
pnpm test
pnpm typecheck
pnpm test:browser
pnpm test:live
```

Stop the existing project preview before rebuilding on Windows: workerd holds the build directory open. The update command starts a missing production server automatically. It uses a lightweight health endpoint, an exclusive PID lock and a database lease. Structured job logs are in `.sites-runtime/updates.jsonl`; consistent SQLite backups are in `.sites-runtime/backups/`. Credentials remain in `.env.local`, outside client bundles and backups made by the source archive command.

The installed tasks are `PitchPredict-Fixtures` (30 minutes), `PitchPredict-NewsSocial` (60 minutes) and `PitchPredict-Daily` (daily). They run with the current user's limited privileges and hidden consoles. The Windows user must be signed in; the computer must be awake. StartWhenAvailable catches missed runs. Daily maintenance discovers datasets, imports an incremental batch, reconciles entities, evaluates calibration and backs up the database. Current imported OpenFootball datasets rotate through fixture refreshes. Tasks do not guarantee complete or real-time provider coverage.

## Sources and permissions

`lib/football/source-registry.mjs` defines endpoints, terms/license references, automation/storage/training decisions, attribution, refresh intervals, conservative local budgets and retention. Runtime configuration and attempt/success/error state persist in `source_registry`. Unknown or prohibited automation/storage disables a source; an absent optional key also disables it. Administrator Diagnostics explains why.

Registration-free sources: OpenFootball repositories with a confirmed CC0 license, Wikidata CC0, TheSportsDB's public development API, permitted BBC/Guardian headline feeds, StatsBomb Open Data, and Internet Archive availability metadata. TheSportsDB public responses can be small or incomplete. Its local development permission is not a blanket production redistribution license. Images are linked at their original URLs; this project does not rehost media.

Optional free credentials: `FOOTBALL_DATA_KEY`, `API_FOOTBALL_KEY`, `YOUTUBE_API_KEY`. Register directly with the respective provider and put the values in `.env.local`. No paid subscription is needed for the supported free features. API-Football remains limited to 100 daily attempts, with selected matches prioritized by the existing visible-match scheduler. The official API-Sports widget uses fresh local cached responses through `/api/widget-data/`; it cannot call the provider directly or reveal the server key. A widget with no matching cache shows unavailable data.

Add custom permitted RSS/Atom definitions in `config/football-sources.json`. Explicit automation/storage permission, attribution, publisher hosts, terms/license URLs and retention are required. Full articles are never copied. Official FIFA/UEFA/confederation pages without a verified feed, Instagram/Facebook/X ingestion and restricted sports websites stay disabled for automatic collection. Their original websites remain manual verification links. Archive support queries snapshot availability only; it does not scrape archived pages or override the original site's restrictions.

## Evidence, identities and model boundaries

Migration `drizzle/0002_football_intelligence.sql` is additive and idempotent. Runtime initialization applies the same SQL. Existing basketball and football tables are preserved. New tables cover sources, HTTP cache, per-source request usage, canonical entities and aliases, field claims, disagreements, social accounts/evidence, verification candidates, dataset files, immutable snapshots, calibration models, update jobs and confederations.

Claims retain source URLs/post IDs, retrieval/publication/knowledge times, confidence, verification, license references, validity intervals and expiration. Explicit cross-provider fixture references reconcile identities; ambiguous names require review. The system does not guess that similarly named clubs are identical. Both disagreeing score/status claims remain inspectable. Historical records added today are first known today.

Snapshot windows are seven days, 72 hours, 24 hours, six hours, one hour and official lineup publication. Database triggers reject snapshot updates/deletes. A missing observation or unverified kickoff timezone produces a **missed** snapshot instead of retrospective fabrication. OpenFootball's date-only kickoff values are ordering aids, not asserted UTC kickoff times. Unresolved tournament slots are excluded.

The independent model calculates weighted form, Elo, scoring/conceding, home/away form, head-to-head, rest/congestion, BTTS, clean sheets, totals and a score distribution. Missing injury, lineup, standings, competition-strength and source-agreement features remain unavailable. The legacy model continues to use supported lineup/injury/statistics inputs when present. Probable lineups require sufficient actual player evidence.

Calibration uses fixture-grouped chronological partitions and purges outcomes unavailable at each boundary. Only training-permitted evidence is eligible. An installed calibration algorithm is **not evidence of a validated model**: real evaluation needs enough future observations followed by completed matches. The app reports insufficient data rather than claiming calibrated accuracy. Imported final scores cannot reconstruct genuine earlier information states.

Social classifiers operate only on actual available metadata or explicitly user-supplied text. They produce candidates, not confirmed injury facts. Wikidata social accounts need official corroboration before ingestion. Image-derived uncertain names enter the review queue; no OCR text is invented for inaccessible posts. YouTube metadata requires a free API key and a verified channel, and expires after its retention period.

## Validation

Default tests use in-memory SQLite and mock provider responses; they never depend on third-party availability. Browser smoke checks use installed Chrome, block external requests and suppress synchronization. Screenshots are written to `outputs/football-desktop.png` and `outputs/football-mobile.png`. `test:live` and the import commands are separate, optional live network operations.

Coverage is incremental. A discovered dataset is not an imported competition, and a competition catalog entry does not promise fixtures or player coverage. The requested UEFA Europa/Conference examples currently include qualifying files where that is the published data. Missing seasons, official lineups, social posts and unavailable live feeds remain clearly labeled.
