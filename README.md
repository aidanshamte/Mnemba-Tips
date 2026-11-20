Local visual-identity feature: [VISUAL_IDENTITIES_REPORT.md](VISUAL_IDENTITIES_REPORT.md) — queued for the next normal Azure release.

Live pipeline checkpoint: [LIVE_PIPELINE_REPORT.md](LIVE_PIPELINE_REPORT.md) — central worker, SSE, and explicit LiveScore authorization/configuration blockers.

# Mnemba Tips

Latest Azure verification: [worldwide release report](WORLDWIDE_RELEASE_REPORT.md).
It records every target league's actual local/production counts, source and image gaps,
chronological model measurements, and remaining operational blockers. Follow the
[progress log](MASTER_PROGRESS.md) for the current deployment and job evidence.

Football intelligence with real imported fixtures, searchable teams and competitions,
internal news briefings, dated form/H2H and transparent goal-model estimates.
Saved pre-kickoff versions and verified result comparisons are at
`/football/predictions`; date-only previews stay separate from tracked accuracy.
The public football desk is at `/football` (also `/`). Legacy demo/admin routes
redirect to the real product. Basketball calculations and scenarios are preserved
internally, outside public navigation and production prediction APIs.

## Run

Requires Node 22.13+ (verified here on Node 24/Linux Codespaces).

```sh
npm install
node scripts/setup-internal-access.mjs
npm run build
npm start
```

The current development preview is **http://localhost:5173/football**. Start it with `npm run dev -- --host 0.0.0.0`. Run only one local server at a time: development and production share the SQLite database. The startup guard rejects a second worker.

For the production commands above, open **http://127.0.0.1:8787/football**. In Codespaces, open the forwarded port
8787 from the Ports panel. No public deployment is performed by these commands.
The local database persists under `.wrangler/state`. Keys belong in `.env.local`;
copy `.env.example` on a fresh clone. Never commit credentials.

```sh
npm run backup
npm run import:priority
npm run sync
npm run schedule
```

The priority importer loads discovered CC0 OpenFootball files for the current and
previous seasons of La Liga, Serie A, Ligue 1 and Premier League. It records each
outcome in `outputs/priority-imports.jsonl`; unavailable files stay unavailable.
It does not invent a fixture when a source is missing.

`npm run schedule` runs in the foreground alongside the server. It honors persisted
job due times, source quotas/backoff and database locks, and backs up daily.
It stops when the process or Codespace stops. `npm run schedule -- --once` runs one
pass. It does not install system services or purchase a provider plan.

## Verify

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:system
npm run build
npm run test:browser
node scripts/verify-public-release.mjs
node scripts/backtest-local.mjs
```

Browser verification uses pinned Playwright 1.63.0 through npm exec and requires Chromium/Chrome; set `MNEMBA_TEST_BROWSER` to its
executable or install a browser with `npx --yes --package=@playwright/test playwright install chromium`.
The smoke script detects the active local app (or `MNEMBA_ORIGIN`) and Playwright Chromium and optional Linux libraries unpacked
under `.sites-runtime/browser-libs`. Screenshots and actual API evidence go to `outputs/`.
The browser suite uses persisted records and checks real badge image requests and
publisher player loading. Isolated timezone edge-case responses are never persisted.
`node scripts/check-video.mjs` separately attempts playback and reports provider
restrictions; do not bypass any sign-in or bot challenge.

## Data and prediction integrity

Competition menus consolidate explicit aliases while retaining every provider ID.
Counts are imported records, not a promise of complete coverage. Source-supplied
calendar dates remain date-only where the timezone is unknown. Generic initials
replace missing badges. The stadium image is original illustration, not a photograph
of a specific match; its prompt and provenance are in `public/ARTWORK.md`.

Exploratory estimates are saved with their timestamp and feature factors in the
immutable `exploratory_estimates` table. They are excluded from prospective forecast
accuracy. Verified-time forecasts have their own immutable records and grading.
The historical comparison in `outputs/backtest.json` uses earlier match dates only,
but is explicitly a reconstruction using data retrieved later, not tracked accuracy.

Goals-only markets cover regulation time. Corners, cards, player markets and combined
bet probabilities are not claimed. No authorized bookmaker odds are configured.

Read `PUBLIC_EXPERIENCE_REPORT.md` for the latest verified state and limitations.
`RELEASE_REPORT.md` records the previous implementation checkpoint.
Earlier `MASTER_REPORT.md` and upgrade reports describe prior work, not this release's checks.


## Internal controls

Sensitive API views and sync/source-policy writes require the ignored local
`MNEMBA_INTERNAL_TOKEN` credential; localhost is not authorization. Internal scripts
read it through `scripts/internal-access.mjs`. Never include it in a public URL,
client bundle, screenshot or commit. Public match refresh is separately protected
by same-origin checks and the existing provider budgets and update locks.

Run `node scripts/upgrade-imports.mjs` for the reviewed badge/player metadata jobs.
Badge mappings are conservative and incomplete; club marks remain their owners’
property. Browser timezone preferences are local to each visitor and are not
embedded into shared match URLs.

Latest modification evidence: [LIFECYCLE_REPORT.md](LIFECYCLE_REPORT.md).


Local media workflow: `pnpm media:enrich` runs bounded entity and news media jobs; `node scripts/report-media.mjs` writes a read-only coverage snapshot. Use `pnpm schedule` for the existing local scheduler (one instance only). Media acceptance evidence and provider limits: [MEDIA_REPORT.md](MEDIA_REPORT.md).
