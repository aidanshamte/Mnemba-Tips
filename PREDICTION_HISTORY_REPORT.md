# Prediction history continuation — 13 September 2026

## Production diagnosis

Read-only remote D1 queries confirmed 0 `analysis_forecasts`, 0 `analysis_grades`
and 518 `exploratory_estimates`. The old public history query selected only tracked
forecasts, so none of those exploratory previews appeared. The last stored model
job succeeded at 2026-09-12 16:13:50.677 UTC: captured 0, abstained 13, exploratory 2;
its evaluation had 0 eligible pairs against a 200-pair minimum. This establishes
an empty tracked archive and a rendering exclusion, not a complete diagnosis of
every fixture today. Date-only fixtures explicitly abstain from tracked capture.

The schema lookup found no table named `match_analysis_reports`. Additional queries
for today's kickoff precision, analysis-processing reasons and `cron_runs` failed
with Cloudflare code 7500: account daily D1 row-read quota exceeded. Stored
`update_jobs` successes are not proof of successful Cloudflare Cron execution.
No fresh production backup or migration was performed. This change needs no schema
migration and does not write or reconstruct forecasts.

## Implemented

- Five compact timezone choices, automatic local default, searchable regional
  timezone dialog whose full options mount only while open, saved local preference.
- Today, Yesterday, Last 7 days, Pending, Completed, Exploratory previews and All.
- Date filtering before pagination; exact kickoffs use the chosen timezone, while
  date-only fixtures retain their published calendar date.
- Exploratory records included and explicitly excluded from grading/accuracy.
- Saved probabilities and versions retained, fixture status and competition shown,
  saved timestamps use the selected timezone; stale fetches are aborted.
- Public learning record sourced from existing model metrics/job records, with
  insufficient-sample states, production version and evaluation schedule caveat.

## Verification

`pnpm typecheck`, `pnpm test` (5 unit and 16 system files), `pnpm build`, and
`pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json` passed.
New SQLite regression covers local-date boundaries, date-only records, pagination,
exploratory separation and pending/void transitions. Existing suites cover
basketball, migrations, immutable forecasts, settlement, leakage and cron locks.
Desktop/mobile browser checks passed (compact options, regional search, persisted choice, no horizontal overflow). Browser test: `scripts/browser-history.mjs`; screenshots: `outputs/history/`.

## Remaining scope

Production today's fixture-level diagnosis, public data verification and real Cron
execution evidence are blocked by D1 quota. Zero tracked/graded means zero pending
tracked forecasts at the successful query time; measured accuracy/Brier are absent.
No predictive improvement or validated calibration is claimed.

The existing Tier 1 registry includes result, double chance, draw no bet, totals,
BTTS, scores, exact/range goals, margin, clean sheet, win to nil, European/Asian
handicap and score-derived joint selections. These are provisional model outputs,
not demonstrated out-of-sample market accuracy. Event/half, player, card, corner and
referee markets remain withheld for missing validated histories/models. No new
referee importer or shrinkage model was implemented in this pass. The broader brief's
batch retraining/calibration promotion gates, complete per-market grading/card
presentation and expanded ranking criteria still need further work; this report
does not claim the entire brief is complete.

## Deployment evidence

Implementation commit `9eb7f00` was pushed to `origin/main` and deployed as Worker
version `58ccfbbf-e229-42fd-8a47-e046bd8d196a` at
https://mnemba-tips.kaidan547.workers.dev. The D1 binding and all three Cron schedules
were preserved. Public desktop/mobile timezone search, persistence and layout
checks passed. The public history API returned HTTP 503 after deployment; D1 quota
remains unresolved, so rendered production records and learning metrics could not
be verified. Public screenshots show the actual unavailable state, not test data.
