> 21 November 2026 compact UI checkpoint (branch `feature/compact-ui`): rem type scale (body/team 15px, headings and prediction 20px, labels 12–13px, score 26px), UI font for h2/h3/team names; prediction card reordered (Prediction → Pre-match/Early estimate → outcome → H/D/A → uncertainty → saved/freshness → actions) with Elo/equations/provenance in an "Analysis details" disclosure; "Featured leagues" config (`config/featured-competitions.json`) with device-local pins that only reorder; Live toggle with "Show all matches" reset; carousel at most two slides per league. No model, probability, timestamp or grading change. Release pending verification.

> 5 October 2026 presentation update: responsive 112/96/76px match crests and 48/44px competition branding deployed as `mnemba-web--crest-size-20261005`; production desktop/mobile checks passed with zero visual URL mapping changes. See [LOGO_PRESENTATION_REPORT.md](LOGO_PRESENTATION_REPORT.md).

> 5 October 2026 logo production checkpoint: deployed; teams 2,615/3,577, competitions 144/268, original competition set 68/68, Tanzania 16/16. Local teams 792/1,286. Coverage remains incomplete. See [LOGO_COMPLETION_REPORT.md](LOGO_COMPLETION_REPORT.md) and the exact lists under `reports/`. Older local-only/no-deployment statements below are historical.

# Real-logo completion — IN PROGRESS

Continue from [REAL_LOGO_COVERAGE_REPORT.md](REAL_LOGO_COVERAGE_REPORT.md). The owner confirmed intended image permissions; no logo pack is pending. Local real-image enrichment is underway and supersedes the zero-logo counts below. Tanzania reached 16/16 teams and 1/1 league; all 68 competition records have validated images. Six real-image regional browser checks and Azure production build passed. Latest recorded team checkpoint: 576/1,286; resumable enrichment continues. Worldwide team completion remains outstanding. No deployment.

---

# Local visual-identity checkpoint — 21 September 2026

[VISUAL_IDENTITIES_REPORT.md](VISUAL_IDENTITIES_REPORT.md) records this focused feature. Production remains the live-pipeline release below; **no Azure deployment was requested for this feature**. Include it in the next normal release.

- COMPLETE: centralized team/competition visual resolver; verified media and alias filtering; neutral SVG initials; batched/cached metadata; lazy loading; error/timeout fallback; visual credits; football cards/details/search/league navigation/profiles/history/standings/coverage integration. No migration or prediction-model change.
- LOCAL AUDIT: 1,286 team identity records, zero permission-cleared real logos, 1,286 fallbacks; 68 competition identity records, zero permission-cleared real logos, 68 fallbacks. Zero missing visual fallbacks. Legacy provider-linked badge metadata is retained but is not accepted as image-level permission.
- SOURCES: bounded enrichment through existing clients; the two exact persisted Wikidata club identities yielded no eligible logo claim. No team-name guessing, arbitrary image hotlinks, new subscriptions or external image search.
- VERIFIED: four targeted resolver tests; seven relevant regression files; typecheck/build; seven regional match views, CAF coverage fallback, image loading/failure/timeout, and desktop/mobile football/search/history/news/profiles/basketball browser checks. Evidence in `.sites-runtime/visual-identities/`.
- PREVIEW: verified local Azure/Next runtime at `http://localhost:5183`, updates disabled, isolated `local_verified` PostgreSQL schema. Development port 5173 is stopped; this supersedes the earlier preview status below.
- BLOCKED: real-logo rights/identity gaps. Every unsupported identity still receives a neutral badge. The development worker drops match-context requests, so browser verification uses the local Azure runtime and isolated PostgreSQL clone.
- NEXT: include visual identities in the next normal Azure deployment; independently obtain image-level permissions or exact Commons identities. Do not redo the completed live pipeline or worldwide audit.

---

# Current live pipeline checkpoint — 21 September 2026

Read [LIVE_PIPELINE_REPORT.md](LIVE_PIPELINE_REPORT.md) first; do not repeat the prior worldwide audit or provider research.

## COMPLETED

- Existing provider/store/provenance architecture extended with centralized live worker, meaningful state diffing, incident deduplication, durable snapshots, bounded SSE with replay/HTTP fallback, and existing match-page score/status/minute/details updates. No migration, model change, UI redesign or replacement system.
- LiveScore discovery/scoreboard/incidents/lineups adapter is a **disabled contract candidate**, tested with synthetic examples only. No verified LiveScore response contract or permission grant was supplied. Perform/Opta requests remain disabled; no invented third-party parser or access tokens.
- Deployed `live-20260921`, digest `sha256:d3857fb8df980c8089effd3583dd16fe369455c9ecdec220855f495f17a940fa`, to ready Azure revision `mnemba-web--0000011` and all three existing update jobs. Existing job commands/schedules preserved. Web minimum replicas 0 → 1 keeps its additional central worker running; no new Azure service.

## VERIFIED

- 132 regression tests passed, zero skipped, with real isolated PostgreSQL integration. Typecheck, new-module lint and production build pass. One Docker image built; one web deployment.
- Isolated PostgreSQL → SSE → desktop/mobile browser score/incident changes and HTTP fallback pass; saved pre-match analysis unchanged. Synthetic state restored, never written to production.
- Canonical production health/database, SSE transport and access controls pass. Desktop/mobile football, saved prediction/history, search, news, player profiles and basketball checks pass.
- Azure worker startup observed at 03:08:50 UTC, state `not-configured`. Existing hourly automatic job `mnemba-update-0-29832660` succeeded at 03:03:38 on prior image; new-image verification `mnemba-update-0-sih0f3q` succeeded in Azure at 03:13:51 UTC (models/media succeeded; fixtures/results/snapshots not due).
- Local preview restored at `http://localhost:5173`; isolated rehearsal containers stopped with data preserved.
- Durable production football backup verified; no migration required. Protected evidence: `.sites-runtime/live-release/`.

## BLOCKED

- Actual live ingestion: production has no API_FOOTBALL_KEY or FOOTBALL_DATA_KEY. LiveScore lacks written automation/storage/public-display rights, exact discovery URL, sanitized schema examples, timezone verification and approved quotas. Enable flag alone cannot bypass these gates. Perform/Opta requires a separate grant and response contract.
- No actual provider-to-production live score change is claimed. LiveScore implementation cannot be called a verified working vendor integration until those inputs arrive.

## DEFERRED

- Worldwide expansion, optional media/news/ML work and unrelated lint debt. Prior external video-feed HTTP 404 is outside this session.

## NEXT

- Obtain one permitted live-provider configuration, validate its entitlement/response contract, then observe one real match update through ingestion, persistence, SSE and the browser. Do not repeat completed builds or redesign working components.

---

# Current verified release — 21 September 2026

Full league-by-league evidence: [WORLDWIDE_RELEASE_REPORT.md](WORLDWIDE_RELEASE_REPORT.md). Source rights: [SOURCE_REVIEW_2026-09-18.md](SOURCE_REVIEW_2026-09-18.md). Earlier checkpoints below are historical and superseded by this entry.

- Deployed `worldwide-20260921-final` to existing Azure web revision `mnemba-web--0000010` and all three existing scheduled jobs. Immutable digest: `sha256:315b2e60d36380324a7b3796a935ae04152113def3d25dbef37feda488e94b55`. Canonical site and database health verified. No Cloudflare deployment or new paid resources.
- Final 02:48 UTC production audit: 31,738 source fixture records, 1,344 team identities, 245 players, 66 immutable forecast versions, zero grades. Coverage: 38/78 targets have records; remaining targets are gaps. Local: 22,267 fixtures, 1,286 teams, 190 players, 44/78 targets with records. Provider overlap means raw totals are not unique worldwide match counts.
- Tanzania: 720 production historical records across 2023/24–2025/26, no verified upcoming schedule or cleared badges. Latest edition has 239 played matches and one awarded result, excluded from normal training/grading. OpenLigaDB import succeeded: 1,224 fixtures. Final priority batch imported 1,084 fixtures without errors; backfills remain queued.
- Corrected administrative-result parsing, newer-edition priority ordering, future empty-file refresh starvation, and women's tournament labeling. Preserved existing saved data, user access, basketball and source claims. No schema migration required.
- Cleared player-photo registry: production 67/245, local 0/190. No permission inferred for unknown licenses. Kaggle version 679 metadata checked; version 676 files inspected; ESPN upstream reuse/training rights unresolved, no Kaggle ingestion.
- Hourly final-image execution `mnemba-update-0-vjkkle5` succeeded. Separate fixture refresh succeeded. Secondary execution `mnemba-update-1-9l3iobe` was partial: club video feed HTTP 404; news/badges/media/documents succeeded. Daily retention job's September 20 automatic execution succeeded; final image configured, next automatic run not yet verified. Azure schedules operate without Codespaces.
- All 126 tests pass, zero skipped, with actual isolated PostgreSQL integration. TypeScript and production build pass. Final container and canonical production browser/HTTP checks pass, including Tanzania, England, Japan, Brazil, mobile, search, news, history and basketball. Existing lint debt: 86 errors / 17 warnings.
- Historical chronological evaluation covers 37 provider competitions, with 1X2, BTTS and over 2.5 metrics/calibration/sample sizes in `outputs/backtest.json` and the report. This is reconstructed historical evidence, not prospective accuracy; no model promoted.
- Local backups retained in workspace. Fresh private production football-table backup downloaded and validated (24,619 fixtures before imports); SHA-256 `64735ed1f3152e28340a9a44733e32ef553110dfb40fe7a8ad22750b26b474f0`. Not a complete credentials/user-table backup.
- Remaining work: verify additional queued imports and aliases, obtain missing provider keys/rights, source current Tanzania fixtures, resolve external video HTTP 404, increase individually cleared imagery, accumulate verified outcomes before grading/model promotion, and address lint debt. No claim of all leagues live, full player coverage, profitable predictions or complete worldwide scope.
- Local development preview restored at `http://localhost:5173`; completed isolated rehearsal containers stopped, data preserved.
- Reproducible report: `node scripts/worldwide-report.mjs`; protected evidence under `.sites-runtime/worldwide/`. Credentials and private exports remain excluded from Git. Runtime is deployed; later offline evaluation/reporting edits do not change the deployed application.

---

# Historical working notes — 21 September 2026

## Deployment checkpoint, 02:20 UTC

- `worldwide-20260921` is live on ready revision `mnemba-web--0000009`, and all three existing Azure schedules use its immutable image digest. Canonical HTTP/access-control checks and 12 desktop/mobile regional/basketball browser checks pass.
- Production imported Tanzania 2023/24–2025/26 (720 records) plus second-division history. The production loop was paused after its fourth completed batch while improving fair ordering: Tanzania first, then newer editions globally, before older backfills. No active import was overwritten.
- Added existing women's Euro history to the audit (31 local matches) and corrected its public competition category label.
- The unlocked hourly execution `mnemba-update-0-0v1lqe3` completed results/models/snapshots/media; fixtures were partial because an old imported Euro 2028 placeholder returned no valid matches. Its record is now quarantined, and the final code excludes future source years from current-calendar refresh slots. Initial 02:00 scheduled execution correctly reported an import-lock deferral.
- Fresh backup execution `mnemba-import-es68sjd` succeeded. Downloaded, parsed and verified production football export: 24,619 fixtures, 1,147 teams, SHA-256 `64735ed1f3152e28340a9a44733e32ef553110dfb40fe7a8ad22750b26b474f0`.
- Full suite: 28 files pass. Restored PostgreSQL integration: two tests pass, including actual immutable triggers/transactions/locks. New Azure build passes. Historical reconstruction covers 37 provider competitions, with metrics/calibration in `outputs/backtest.json`; no model promotion or prospective accuracy claim.
- Final packaging/deployment and OpenLigaDB's production import remain in progress. Local direct Dutch import hit a SQLite lock and is not claimed complete. The local development watcher was stopped during packaging; isolated Azure/PostgreSQL rehearsal remains on port 5180.

- Resumed the existing uncommitted release. Production initially remained on `global-20260917-1607`; the September 18 image was uploaded but never activated.
- Repaired the vanished temporary PostgreSQL dependency and recreated workspace-local SQLite backups (September 21, 01:41 UTC). The previous September 18 private Azure backup blob still exists.
- Rechecked Kaggle version 676 files: 69,442 unique fixture events, 224 league IDs in 1,348 season/stage rows, latest fixture-row update September 12 despite September 17 upload. No Tanzania league name in the inspected leagues CSV. Daily fresh records and upstream permission remain unverified; no ingestion.
- Fixed awarded/abandoned OpenFootball score parsing. Tanzania has 240 records: 239 played results and one awarded result, excluded from normal grading/history. Preserved fixture IDs and prior evidence.
- All 28 regression files pass; TypeScript and fresh Azure production build pass. Desktop/mobile browser checks pass for Tanzania, England, Japan, Brazil and basketball, with no uncaught page errors. Lint remains 86 errors / 17 warnings.
- Azure's interactive exec endpoint returns WebSocket 404. Started a read-only private backup using a per-execution override of the existing maintenance job (`mnemba-import-es68sjd`); saved job template preserved.
- Protected production diagnostics identify repeated empty historical-file refresh as the hourly partial-failure cause. The pending release includes its backoff repair. Deployment and final job verification remain outstanding.
- Evidence: `.sites-runtime/worldwide/*resume*`, `tests-release.log`, `browser-local.json`. Do not claim deployed until verification below is completed.

---

# Worldwide continuation — 18 September 2026 (in progress)

- Source review: [SOURCE_REVIEW_2026-09-18.md](SOURCE_REVIEW_2026-09-18.md).
- Both local databases backed up. Local backup directory relocated intact to `/tmp/mnemba-preserved-backups-20260918` with original path symlink after disk exhaustion; Azure private backup is the durable production copy.
- Real Tanzania 2025/26 import: 240 fixtures; expanded named targets and coverage freshness/source details. Additional local imports recorded in `.sites-runtime/worldwide/import.log`.
- OpenLigaDB ODbL connector added with UTC validation, last-change polling, caching, no image rights inference and public provider-separated export. Real smoke test caught missing persisted label; fixed with database regression.
- Scheduler numeric skipped-record counts no longer abort later jobs. Empty historical file backoff fixes already in workspace are included in the pending release.
- 28 regression files passed before final adapter persistence fix; focused persistence regression passed. Final full checks, local browser, integrity and deployment remain in progress; do not claim deployed yet.
- Production baseline audit: 20,097 fixtures, 1,025 teams, 227 players, zero tracked/graded forecasts. Existing Azure jobs run without Codespaces but report partial failures.
- Evidence: `.sites-runtime/worldwide/`. Database schemas unchanged; credentials and user edits preserved. Kaggle ESPN is disabled pending upstream rights, not silently imported.

---

# Current status — production coverage release, 17 September 2026

Latest release: [GLOBAL_COVERAGE_REPORT.md](GLOBAL_COVERAGE_REPORT.md) and
[PRODUCT_USEFULNESS_REPORT.md](PRODUCT_USEFULNESS_REPORT.md).

- Azure web and all three update jobs use `global-20260917-1607`; ready web revision `mnemba-web--0000008`.
- Canonical HTTPS health, public routes and protected diagnostics checks pass. DNS needs no further change.
- Desktop/mobile coverage filters and existing football/basketball journeys pass; saved previews pass eight match checks and six real badge loads.
- All 27 test files and standard/Azure TypeScript checks pass. Earlier Docker build and PostgreSQL restore evidence remain recorded in the release report.
- First-batch production coverage and remaining source gaps are recorded in the coverage report. Historical imports do not establish complete current seasons or improved predictive accuracy.
- Existing lint debt remains. Cloudflare is preserved. Earlier checkpoints below are historical.

---

# Historical status — lifecycle continuation, 12 September 2026

Latest implementation: [LIFECYCLE_REPORT.md](LIFECYCLE_REPORT.md).

- [x] Status-based scheduled/live/completed handling; real Liverpool–Fulham fixed.
- [x] Cutoff-before-limit history and partial analysis preserved.
- [x] Immutable tracked forecasts, separate exploratory previews, public history.
- [x] Automatic audited grading, corrections/voids, canonical headline counting.
- [x] Persistent analysis batches and per-fixture failure isolation.
- [x] Normalized confirmed XI and conservative participation-based projections.
- [x] Locked chronological candidate criteria, versioned parameters, rollback.
- [x] Unit/system tests, typecheck, build, and desktop/mobile browser checks pass.
- [ ] Predictive improvement: zero real eligible graded pairs; baseline retained.
- [ ] Existing lint debt: 79 errors / 9 warnings. Broader live/lineup coverage missing.

Evidence: `outputs/lifecycle/`. Startup workflow remains unchanged: one preview
at port 5173, one authenticated scheduler. Local tasks pause when Codespaces stops.
Read the lifecycle report before continuing; checkpoints below are historical.

---

# Current status — public experience upgrade, 12 September 2026

The latest implementation is documented in `PUBLIC_EXPERIENCE_REPORT.md`.

- [x] Public five-section navigation, real root route, retired demo/admin redirects.
- [x] Sensitive API reads/writes require internal authorization; public refresh works.
- [x] Browser-local timezone preferences, local date filters and DST tests.
- [x] Eligible match insights replace zero-accuracy marketing.
- [x] Historical season opener has earlier form/H2H, no all-zero ranking or invented XI.
- [x] Nine target player identities searchable with accents/typos; ten real records added.
- [x] Conservative badge mappings with country/suffix checks and neutral fallbacks.
- [x] Internal news layouts, original imagery and three real publisher video embeds.
- [x] Typecheck, unit/system regression suites, production build and final browser suite pass.
- [x] Scheduler restarted with internal authentication; due jobs passed and continuous
  updates are running alongside the single preview at `http://localhost:5173/football`.
- [ ] Full badge/squad/statistics coverage: 25/668 badges mapped, remaining gaps explicit.
- [ ] YouTube playback: player loads, but Codespaces playback is blocked by YouTube's
  sign-in/bot check. Fallback works; no bypass attempted.
- [ ] Repository lint: 79 errors / 9 warnings remain; rules unchanged.

Latest evidence: `outputs/page-upgrade/`. Next optional work is expanded verified
identity/badge coverage, authorized richer reporting and existing lint debt.
The sections below preserve the earlier checkpoints and investigation history.

---

# Mnemba Tips release progress — updated 2026-09-12

## Current handoff
- Verified usable preview, responsive artwork, competition search, real imports,
  saved exploratory estimates, goal markets, internal news and basketball.
- Final `npm run build`, `npm run typecheck`, `npm run test:unit`,
  `npm run test:system` and `npm run test:browser` pass. Evidence: `outputs/`.
- `npm run lint` still fails with 82 errors / 9 warnings; no rules weakened.
- 6,817 distinct fixtures, 666 teams, 180 players, 220 news records. La Liga
  760, Serie A 760, Ligue 1 612 source fixtures. Zero graded prospective forecasts.
- Preview: `npm run dev -- --host 0.0.0.0`, port 5173. Scheduler:
  `npm run schedule`; verified one full cycle and started continuous process.
- Next work: resolve lint debt, verify broader current UEFA/provider coverage,
  competition-specific table rules and verified social identities. These remain
  unfinished; see `RELEASE_REPORT.md` for metrics and exact limitations.

The checkpoints below preserve the initial investigation history; they are not
a claim that every requirement in the original brief is now complete.

Environment: Linux Codespaces, Node 24, React/Vinext, local Cloudflare D1 SQLite.
User's existing untracked package-lock.json preserved. Database backed up before changes:
`.sites-runtime/backups/football-2026-09-11T17-52-43-481Z.sqlite`.

## Checkpoints
- [x] Inspect repository, runtime scripts, ingestion, search and model paths.
- [x] Baseline unit/system suites pass (16 test files); initial typecheck passes.
- [ ] A: Verify actual coverage; repair missing priority imports and filter identities.
- [ ] B: Verify evidence-backed estimates and saved forecast eligibility.
- [ ] C: Mnemba Tips branding, real artwork, accessible rotating fixtures/mobile picker.
- [ ] D: Verify markets/news/refresh; portable automatic updates.
- [ ] E: Production build, browser journeys/screenshots and release report.

## Confirmed issues
- Public app still branded PitchPredict; hero uses only CSS pitch shapes.
- Slideshow favors two leagues, lacks swipe/reduced-motion and empty/error distinction.
- Browser script hardcodes Windows Chrome and a historical fixture ID.
- Fixture keyword/confederation filters apply only after fetching a page.
- Existing featured importer omits La Liga and most priority European leagues.
- Local server initial start failed with sandbox EPERM binding localhost; retrying with permitted escalation.

Next: inspect running API/database counts, import permitted priority historical files, then implement and verify UI changes.

## Mid-session evidence
- Existing unit/system tests + four new release regressions pass (17 test files).
- Typecheck and first production build pass. Lint remains failing: 83 errors,
  primarily pre-existing `any` types and React effect/memoization issues. Rules unchanged.
- Imported La Liga 2025–26 and 2026–27: 380 fixtures each; current Serie A: 380;
  current Ligue 1: 306. Historical Italy/France requests hit worker-restart 503s;
  importer now logs and retries transient responses rather than stopping the whole run.
- Added schema 0005 for immutable exploratory estimates, deliberately separate
  from prospective tracked accuracy. Added computed regulation-time goal markets.
- Added original locally served stadium artwork (768/1536 WebP), branding,
  searchable competition dialog, swipe/pause/reduced-motion slideshow.
- Browser first blocked by absent Chromium/shared libraries. Downloaded browser
  and unpacked required libraries under `.sites-runtime/browser-libs`.
- Browser then revealed old worker modules after rebuild. Clean restart in progress.

## Public experience upgrade — 2026-09-12
- Latest pasted brief supersedes public demo/social/admin navigation requirements.
- Backup completed: `.sites-runtime/backups/football-2026-09-12T09-01-06-427Z.sqlite`.
- Implemented five-section navigation, retired demo redirects, server-side internal
  bearer authorization, browser-local timezone preference, DST-aware date filters,
  match insights, season-opener table suppression, historical membership separation,
  player search route and editorial news layout with approved video-player validation.
- Corrected SportsDB team adapter: old undocumented lookup endpoint returned the
  same English League 1 sample for every league. Documented search_all_teams returns
  ten records per league on free tier. 51 existing team identities have mapped badges;
  further matching and real image verification pending. No invented crests.
- All nine requested player identities now persisted through Wikidata; 10 identities
  imported including a disambiguated namesake. No current-club claims inferred.
- Three FC Barcelona official feed video briefings imported; oEmbed confirms publisher
  and enabled player. No media downloads/transcription/AI analysis.
- Typecheck and 5 unit / 13 system files pass. Lint: 80 errors, 12 warnings; baseline
  debt remains. Browser rerun in progress after waiting for the competition dialog.
- Next: complete real browser acceptance, fix any findings, build, update report and
  leave the single preview worker and authorized scheduler running.


## Local media pass — 13 September 2026

Implemented real news media selection, conservative media registry/enrichment, visual search and compact expandable match pages. Current coverage: 25/795 badge mappings, 0/190 portraits, 132 article images, 3 video posters and 139 publisher placeholders. External portrait loads and YouTube playback remain provider-blocked. See [MEDIA_REPORT.md](MEDIA_REPORT.md) for actual verification, screenshots, local runtime and limitations. This supersedes earlier in-progress media counts, without changing historical deployment records. No remote operation was performed in this pass.
