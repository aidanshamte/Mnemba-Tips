# Mnemba Tips — verified implementation report

Work performed in `/workspaces/Mnemba-Tips`, Linux Codespaces, Node 24.20.0,
React/Vinext with the existing local D1/SQLite database. No public deployment,
paid provider, account creation, destructive migration or secret changes.

## Implemented and verified

- Public Mnemba Tips branding, metadata, SVG favicon and web manifest.
- Original stadium artwork served locally in responsive 54 KB / 154 KB WebP
  variants, with a PNG fallback and visible illustration attribution.
- Dynamic fixture slideshow rotates across competitions; arrows, pause, swipe,
  focus pause, page-visibility pause and reduced-motion support are implemented.
- Searchable modal competition picker with native dialog focus management.
  Explicit aliases consolidate provider choices while retaining their IDs.
- Database fixture keyword/confederation filters run before pagination.
- La Liga discovery was already present but never imported by the featured job.
  The new resumable priority importer loads the missing real datasets, records
  inserted/updated/unchanged/failed counts, and reports transient failures.
- OpenFootball's generated Premier League JSON and upstream text copies are
  reconciled using the documented source relationship, identical participant IDs,
  season and round. 380 copied fixtures consolidated; source records retained.
  The pre-existing German reconciliation matched 272 and left 34 unresolved.
- FC Augsburg search, typo search (`Augsbrg`), opaque profile routes and La Liga
  alias search verified through actual database-backed endpoints.
- Immutable saved exploratory estimates with calculation time, model version,
  feature factors and source-revision fingerprint. These are deliberately separate
  from timed prospective forecasts and never counted as measured accuracy.
- Result, double chance, draw-no-bet, BTTS, goal totals, team totals, scoreline
  distribution and home handicap analysis from a single joint goals distribution.
  Push rules, regulation-time scope, missing markets and uncertainty are shown.
- Goal forecasts are not graded from after-extra-time/penalty final scores.
- Match refresh reports progress and completion/deferred states; sources, form,
  H2H, raw reported stage/season and incomplete table labels are retained.
- Existing internal news briefings preserved; no invented article summaries.
- Advanced diagnostics no longer expands arbitrary provider payloads into an
  unbounded recursive DOM. Its source preview is limited and labelled.
- Portable local scheduler, daily database backup and persisted due-time handling.
  SourceHttp retains source budgets, caching, retries and backoff; SQLite leases
  prevent overlapping syncs. Local updates stop when the machine/Codespace stops.

Backups made before changes and after imports:
- `.sites-runtime/backups/football-2026-09-11T17-52-43-481Z.sqlite`
- `.sites-runtime/backups/football-2026-09-11T18-17-39-687Z.sqlite`

## Real import and source evidence

The new imports added 2,132 raw fixtures: La Liga 760, Serie A 760 and Ligue 1 612,
covering 2025–26 and 2026–27. Existing Premier League seasons were refreshed.
Intermediate worker-restart failures were retained in the import log; the missing
Italy/France historical files were subsequently imported successfully.

[OpenFootball's repository](https://github.com/openfootball/football.json) documents
CC0/public-domain data, the country leagues, and JSON generation from upstream
Football.TXT sources. This supplies permitted historical and scheduled records;
it is not an official live-score feed.

The stored Athletic Club–Arsenal record is dated 16 September 2025 and marked
`League, Matchday 1` in season 2025–26. Date and league-phase classification were
independently checked against [Athletic Club's official announcement](https://www.athletic-club.eus/en/news/2025/08/30/athletic-host-arsenal-at-san-mames-for-first-champions-league-match/)
and [UEFA's published matchday schedule](https://editorial.uefa.com/resources/029c-1e9a3bf32351-6af9bd65aa7c-1000/uefa_champions_league_-_2025-26_-_league_phase_fixtures_by_matchday.pdf).
This does not claim complete current-season Champions League coverage.

Racing Santander–Deportivo Alavés, 12 September 2026, is a real imported upcoming
La Liga fixture, also listed by [La Liga](https://www.laliga.com/en-NG/match/temporada-2026-2027-laliga-ea-sports-r-racing-club-deportivo-alaves-5).
Its saved estimate uses four and ten recent recorded matches respectively, with
no imported earlier H2H. Model probabilities: home 30.65%, draw 22.07%, away 47.28%.
The app retains date-only kickoff precision; it does not invent a verified timezone.

Detailed counts, exact estimate timestamps/factors, search examples and article
responses are in `outputs/release-evidence.json`; import accounting is in
`outputs/priority-imports.jsonl`; reconciliation is in `outputs/mirror-reconciliation.json`.

## Prediction measurement

Prospective completed forecasts: **0**. Measured prospective accuracy: **unavailable**.
The app displays “Prediction tracking is starting” and does not substitute a backtest
for that count. Existing capture/grading code is tested with deterministic records.

`node scripts/backtest-local.mjs` runs a separate read-only historical comparison.
The first 80% of dated results precede held-out dates; same-date matches remain in
the same partition. Rolling features use earlier dates only. The Elo comparator's
draw prior uses the initial training partition. Results were retrieved later, so
historical publication/availability cannot be certified. This is reconstruction,
not an authentic prior forecast or a reason to promise future performance.

| Historical competition | Eligible test matches | Coverage | Accuracy | Brier | Log loss | Elo log loss | Uniform log loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| La Liga | 78 | 90.7% | 41.0% | 0.634 | 1.055 | 1.061 | 1.099 |
| Serie A | 77 | 90.6% | 53.2% | 0.588 | 0.992 | 0.993 | 1.099 |
| Ligue 1 | 64 | 91.4% | 43.8% | 0.661 | 1.084 | 1.051 | 1.099 |

Evaluation periods and calibration bins are in `outputs/backtest.json`.
The goal baseline did **not** outperform Elo on every competition.

## Implemented but externally limited

- Official live coverage, verified lineups and current injuries depend on supported
  provider coverage and optional `FOOTBALL_DATA_KEY` / `API_FOOTBALL_KEY` credentials.
  No registrations were made and no paid plan was enabled.
- Social/YouTube enrichment still requires verified official accounts and, for
  YouTube's existing adapter, `YOUTUBE_API_KEY`. Unreviewed feeds remain disabled.
- Existing women's, African and Americas records are preserved, but broad complete
  coverage is not established. Europa/Conference records include qualification;
  a consolidated competition choice does not imply main-tournament coverage.
- Thirty-four older Bundesliga mirror mappings remain unresolved and are not
  force-merged. Other cross-provider identity gaps are still possible.

## Not complete

- Repository-wide lint is **not passing**: final run reports 82 errors and 9 warnings,
  largely existing explicit `any` types and React effect/memoization problems.
  The baseline had 86 errors; lint rules were not weakened or disabled to pass.
- No validated first-half, corners, cards, player markets, correlated bet products,
  bookmaker-value claims or automatic wagering.
- Reconstructed tables are labelled incomplete and use generic point/goal ordering;
  complete competition-specific tie-break/deduction handling is not established.
- No full current-season Champions League authoritative import, comprehensive player
  identity repair, or populated verified social account coverage.
- No independent calibration/promotion of a more complex model and no prospective
  accuracy sample yet. Backtest metrics are not a production accuracy claim.
- Slideshow currently features real fixtures, rather than separate news/story slides.

## Run and inspect

Active preview URL: **http://localhost:5173/football**.
Restart the preview with `npm run dev -- --host 0.0.0.0`; open forwarded port 5173 in Codespaces. Alternatively stop the preview, run `npm run build` then `npm start` for production at port 8787. Never run both against the same SQLite files. Run `npm run schedule` in another terminal for ongoing updates.

## Final verification — 2026-09-12

- Final production build: pass (`outputs/build.log`).
- TypeScript: pass (`outputs/typecheck.log`).
- Unit/system tests: pass, 5 unit files and 12 system files, including six new
  release regression cases (`outputs/unit-tests.log`, `outputs/system-tests.log`).
- Browser: pass using Playwright 1.63.0. Desktop/tablet/mobile match pages, all
  classic and primary tabs, carousel arrows/reduced motion, La Liga dialog,
  Augsburg profile, internal news, admin/predictions and basketball; no uncaught
  browser errors. Routine browser checks block provider requests.
- Real match refresh: HTTP 200 with cached context and explicit unavailable
  adapter/identity reasons (`outputs/refresh-verification.json`).
- Scheduled cycle: backup, fixtures, results, models, snapshots, news, retention,
  search index all completed. Models abstained on 126 ineligible fixtures; no
  invented forecasts. Five candidate model fits are not accuracy claims.
- Lint: still failing; see the outstanding work above. No rules weakened.

Current recorded data after that cycle: **6,817 distinct fixtures / 7,469 source
records, 666 teams, 180 players and 220 news records**. La Liga: 760 records;
Serie A: 760; Ligue 1: 612. The raw competition table has 31 provider records;
the picker groups their explicit aliases. Search index: 8,282 documents.

Additional bugs found and repaired during browser/real-source testing:
- The environment ran a preview and a separate verification worker against the
  same SQLite files, causing `SQLITE_BUSY_SNAPSHOT`. Startup guards and an atomic
  process lease now prevent parallel app workers. Scripts detect the active
  origin, including IPv6 localhost, or accept `MNEMBA_ORIGIN`.
- Forwarded CLI `--` previously swallowed the intended `--host` option; it is now
  normalized, and translated to Vinext's `--hostname` spelling, so Codespaces
  can bind the preview to `0.0.0.0`.
- Escaped/truncated RSS HTML was leaking into excerpts and widening mobile news
  cards. The parser now decodes before stripping markup; stored excerpts are
  cleaned on read, and grid items can wrap without overflowing.
- The dedicated search page lacked a main heading; it now has one.
- The prior custom browser driver had unreliable navigation waits. It was
  replaced with Playwright while retaining and extending the actual journeys.

Screenshots:
- `outputs/football-desktop.png`
- `outputs/football-mobile.png`
- `outputs/competition-mobile.png`
- `outputs/match-desktop.png`, `outputs/match-tablet.png`, `outputs/match-mobile.png`
- `outputs/basketball-mobile.png`

Scheduler verification: `outputs/scheduler-verification.log`.
A further backup was created at
`.sites-runtime/backups/football-2026-09-12T07-39-15-947Z.sqlite`.
