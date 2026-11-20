# Match lifecycle modification pass — 12 September 2026

This pass extends the existing football product. It preserves branding, imagery,
slideshow, imported records, search, badges, news, timezone preferences, and the
private/public separation from the preceding public-experience pass.

## Changes

- Match status determines scheduled, in-progress, completed, postponed, cancelled,
  and interrupted states. A passed timestamp never establishes completion.
  Date-only fixtures preserve their calendar date and remain analyzable. A stale
  timed schedule asks for verification. Date-only history cuts off at midnight
  before the published date, excluding uncertain same-day outcomes.
- Historical queries apply their cutoff before the result limit and canonical
  duplicate exclusion. Partial history still returns available factors and form.
- Verified future kickoffs can capture immutable baseline and candidate forecasts.
  Original and later versions remain available after kickoff and restart. Date-only
  exploratory previews stay in a separate archive and never become graded forecasts.
- Match pages include a forecast-version selector and result/exact-score comparison.
  `/football/predictions` is a public, paginated history; navigation exposes it.
- Result ingestion grades automatically. Immutable audit entries preserve corrected,
  withheld, and void decisions; repeated grading is idempotent. Changed kickoffs,
  conflicts, cancellations, and interrupted results cannot inflate headline accuracy.
  Regulation scores are required; extra-time/shootout totals are excluded. Integer
  goal/handicap pushes retain the existing settlement implementation.
- Headline metrics count one latest eligible version per canonical fixture/model.
  Tied maximum result picks are unscored for pick accuracy; exact-score accuracy is
  separate from result-pick accuracy.
- Background analysis uses persistent keyset pagination and per-fixture outcomes.
  A failed fixture does not stop the batch. New batches cover imported scheduled
  fixtures, including beyond the former 150-row and eight-day processing cap.
  Incomplete batches become due again after one minute; failed fixtures retry in
  subsequent batches. The first already-running batch retains its original window.
- Team-sheet normalization supports stored normalized sheets and provider `startXI`
  formats. Confirmed XI is separate from participation-based projection. Projections
  require prior dated sheets, a complete positional XI, recent participation, and
  exclusion of known ended memberships/unavailable players. Sparse coverage remains
  explicit. The results/form probability baseline does **not** use those lineups.
- Candidate parameters are versioned. A candidate needs 200 eligible prospective
  pairs: 100 chronological validation pairs and 100 later held-out pairs. Both
  blocks must improve log loss by more than 0.01 and improve Brier score. A completed
  evaluation is locked per algorithm version; further tuning requires a new version
  and untouched later data. Internal `model-rollback` restores the baseline.
- Proxy-aware public refresh recognizes the forwarded host while retaining origin
  matching and cross-site denial. Operational jobs still require internal auth.

## Verification

Evidence is in `outputs/lifecycle/`:

- `node --test tests/system/*.test.mjs tests/unit/*.test.mjs`: all 19 test files pass.
- `node tests/system/match-lifecycle.test.mjs`: ten focused regression cases pass.
  These use temporary/in-memory SQLite only. They exercise restart persistence,
  immutable originals, corrected grading, voids, 161 processing attempts including
  an isolated failure, a 2,001-row cutoff trap, ties, and promotion/rollback.
- `npm run typecheck`: passes.
- `npm run build`: passes.
- `npm run lint`: 79 errors and 9 warnings remain, matching the prior checkpoint.
  Rules were not weakened. This repository-wide lint debt remains unfinished.
- `npm run test:browser`: public desktop/mobile suite passes. One initial run timed
  out during Mbappé search while the build was running; direct real search and the
  full subsequent browser run passed.
- `npx --yes --package=playwright@1.63.0 node scripts/browser-lifecycle.mjs`:
  real Liverpool–Fulham remains Scheduled and analyzable; isolated, clearly labelled
  browser responses demonstrate scheduled → live → completed with one retained
  prediction, result-correct / exact-score-incorrect display, and no page errors.
  No browser test fixtures are inserted into production storage.

Forwarded HTTPS refresh with Codespaces host headers returned HTTP 200, preserving
cached evidence when the scheduler held the update lease.

Screenshots: `real-liverpool-desktop.png`, `real-liverpool-mobile.png`,
`history-mobile.png`, and `test-NS.png`, `test-1H.png`, `test-FT.png`.

Real model count at verification: **0 tracked forecasts, 0 graded forecasts, and
0 eligible comparison pairs**. The real date-only previews do not inflate these
numbers. The synthetic promotion test is software verification, not evidence of
predictive improvement. The baseline remains primary.

Scheduler logs show successful fixture/result refresh, repeated 50-fixture analysis
pages, and snapshots/news/video jobs. Local updates stop when the Codespace stops. A process interrupted during a job
can leave its lease in place for up to ten minutes; retries respect that expiry
rather than starting competing database work.
No live feed, deployment, guaranteed accuracy, or profitable outcome is claimed.

## Remaining limits

- Configured free sources do not supply full current lineups, injuries, statistics,
  verified kickoff instants, or timely live updates for every fixture. Stale source
  schedules remain scheduled until a provider reports otherwise.
- Identity/membership coverage is incomplete; unknown transfers cannot be ruled out.
  Projections are labelled estimates, never guaranteed selections.
- Existing internal horizon snapshots and legacy model records are retained; the
  public tracked history and headline evaluation use `analysis_forecasts` and audited
  grades. Older diagnostic snapshot coverage is not the public accuracy record.
- Model superiority remains unmeasured. The promotion gate is a minimum software
  criterion, not a statistical guarantee of future improvement.
- Prior YouTube player loading was verified, but actual playback in Codespaces met
  YouTube's sign-in/bot restriction. No bypass or new playback claim was made.
- Lint debt and broader source coverage remain unfinished.

Backup before schema changes:
`.sites-runtime/backups/football-2026-09-12T15-33-53-290Z.sqlite`.
No production database reset or public deployment was performed.


## Local media pass — 13 September 2026

Implemented real news media selection, conservative media registry/enrichment, visual search and compact expandable match pages. Current coverage: 25/795 badge mappings, 0/190 portraits, 132 article images, 3 video posters and 139 publisher placeholders. External portrait loads and YouTube playback remain provider-blocked. See [MEDIA_REPORT.md](MEDIA_REPORT.md) for actual verification, screenshots, local runtime and limitations. This supersedes earlier in-progress media counts, without changing historical deployment records. No remote operation was performed in this pass.
