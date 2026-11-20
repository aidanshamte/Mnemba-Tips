# Local development restored — 13 September 2026

No production database queries, remote migrations, deployment, push or workers.dev
tests were performed during this pass.

## Runtime

- Local: http://localhost:5173
- Codespaces: https://congenial-journey-6q9w6rpxqqpf5j54-5173.app.github.dev
- Worker PID: 16626. Scheduler PID: 18346. Port 8787 has no listener.
- Health returns HTTP 200, `mode: local`, `database: ready`, soccer and basketball.
- These processes and the forwarded URL work only while the Codespace is running.
  Codespaces authentication/port visibility settings still apply.

## Database and protection

Populated database:
`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

Pre-change backup (222,699,520 bytes):
`.sites-runtime/backups/football-2026-09-13T04-40-24-424Z.sqlite`

The separate 749,568-byte empty database was also backed up:
`.sites-runtime/backups/football-2026-09-13T04-40-24-380Z.sqlite`.
Neither database was overwritten. Backups used SQLite's online backup API.

Initial populated counts: 11,792 fixtures, 37 competitions, 790 teams, 190 players,
237 news articles, 452 exploratory estimates, 0 tracked forecasts, 0 grades.
The 518 count from the previous report was production-only. Local records were not
fabricated to match it.

Snapshot at 2026-09-13 04:47:48 UTC after genuine local updates:

| Record | Count |
| --- | ---: |
| Fixtures | 11,795 |
| Competitions | 38 |
| Teams | 795 |
| Players | 190 |
| News | 274 |
| Exploratory estimates | 671 |
| Tracked forecasts | 0 |
| Grades | 0 |

Database size: 222,699,520 bytes; modified 2026-09-13 04:47:40 UTC.
The scheduler remains active, so counts and modification time continue changing.
Machine-readable snapshot: `outputs/local-mode/database.json`.

## Repairs

The previous healthy Worker (PID 7165) used the new production database identity
locally, which selected an empty Miniflare database. Its exact PID and health were
checked, then only that Worker was stopped after backups. Local mode restores the
original local identity `00000000-0000-4000-8000-000000000000` under binding `DB`.
The Vite customization replaces the binding array rather than merging two DB entries.

`.env.local` now sets `MNEMBA_RUNTIME_MODE=local`. Vite explicitly disables remote
bindings and persists to `.wrangler/state`. Generated local build configuration has
one local DB binding and no Cron triggers. The unchanged production configuration
retains its production identity. `pnpm start` uses `--local --persist-to
.wrangler/state`, loads `.env.local`, and refuses mismatched built DB identities or
configuration overrides. Development logs clearly identify LOCAL mode.

Project deployment, remote migration and transfer scripts refuse to run in local
mode. Maintenance origins are restricted to loopback, preventing accidental remote
requests with internal credentials. These guards cover project scripts; they do not
remove a user's ability to invoke an external Wrangler executable manually.

Browser verification now discovers the populated SQLite database instead of taking
the first filename. Existing browser assertions were updated for the current
Matchday Picks heading, persisted tab selection and standings-specific tables.
Overview polling now stops while hidden and aborts requests on view changes.

## Local verification

All requested routes return HTTP 200: `/`, `/football`, `/football/predictions`,
`/football/search`, `/football/shortlists`, `/football/markets`, `/lab`, `/api/health`.
`/lab` intentionally follows its existing redirect to `/football`.

All seven history filters return successfully. Real exploratory cards render;
pending/completed tracked views are honestly empty. Fixtures, catalog, overview,
news, market definitions, player search and authenticated performance API checks
pass. Evidence: `outputs/local-mode/api-verification.json`.

`pnpm typecheck`, `pnpm test` (5 unit and 17 system files), and `pnpm build` pass.
Tests include local-mode remote-operation denial, maintenance-origin restrictions,
basketball probability/lineup behavior, additive schema preservation, immutable
forecasts, result corrections and history pagination/date filters.
Desktop/mobile history browser checks pass, including timezone search, preference
persistence, visible saved previews and overflow. Application console checks pass. The full browser smoke suite also passes: navigation, redirects, access controls, imagery, slideshow, mobile layouts, real player searches, historical season opener, news, badges and timezone/DST rendering.
Screenshots: `outputs/history/desktop.png`, `outputs/history/mobile.png`.

## Scheduler evidence and limits

The established `pnpm schedule` process runs against localhost with its scheduler
PID lease and the application's database job locks/provider budgets. Successful
local runs include fixtures at 04:44:04 UTC, results at 04:44:06, models at 04:44:11,
snapshots at 04:44:13, news at 04:44:14 and video news at 04:44:25. Subsequent model
batches processed 50 fixtures each with no reported errors. Due-time checks preserve
not-yet-due retention/search-index work. Logs: `.sites-runtime/scheduler.jsonl`.

Production D1 quota and real production Cron verification remain unresolved and
were deliberately not tested. No new data-provider coverage, live-score guarantee,
calibrated accuracy or predictive improvement is claimed. Local scheduling stops
when the Codespace stops. The existing private basketball model remains covered by
regression tests; public `/lab` navigation remains retired.


## Local media pass — 13 September 2026

Implemented real news media selection, conservative media registry/enrichment, visual search and compact expandable match pages. Current coverage: 25/795 badge mappings, 0/190 portraits, 132 article images, 3 video posters and 139 publisher placeholders. External portrait loads and YouTube playback remain provider-blocked. See [MEDIA_REPORT.md](MEDIA_REPORT.md) for actual verification, screenshots, local runtime and limitations. This supersedes earlier in-progress media counts, without changing historical deployment records. No remote operation was performed in this pass.
