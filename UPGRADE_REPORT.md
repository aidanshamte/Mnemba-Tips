# PitchPredict upgrade report

Verified September 10, 2026, 10:43 PM America/New_York.

**Running:** http://127.0.0.1:8787 — production server left running. Football desk: `/` and `/football`; preserved basketball/scenario studio: `/lab`; advanced football workspace: `/football/classic`.

## Delivered

Professional responsive football dashboard; keyless fixtures/results and historical fallback; competition and entity exploration; news; original probability/score analysis; source registry and diagnostics; provenance and retained conflicts; immutable pre-match snapshots; time-aware calibration support; social-account verification and candidate queue; optional official widgets served from local cache; Windows scheduled updates, locking, logs and consistent database backups.

The complete file inventory is in [CHANGED_FILES.md](CHANGED_FILES.md). Main changes are under `lib/football/`, `app/api/intelligence/`, `app/api/widget-data/`, `app/api/official-widget/`, `app/football/`, `components/`, `scripts/`, `tests/system/intelligence.test.mjs`, `config/football-sources.json`, `.env.example`, and `drizzle/0002_football_intelligence.sql`. No dependency installation was needed. Existing credentials were not changed. The export has no Git metadata; a pre-change source archive and database backups were retained.

## Database and imports

Migration **0002_football_intelligence.sql** was applied additively through runtime initialization. Its exported SQL matches the tested migration module. Existing basketball and football tables remain intact. SQLite `quick_check` reports `ok`; foreign-key checking returns no errors.

| Measure | Verified count |
|---|---:|
| Competition catalog entries | 25 |
| Competition representations with fixtures | 19 |
| Teams | 562 |
| Stored player/roster profiles | 20 |
| Canonical fixture groups | 3,028 |
| Original fixture source records retained | 3,300 |
| Deduplicated news articles | 143 |
| Provenance claims | 25,360 |
| OpenFootball files imported | 16 |
| Additional discoverable files queued | 3,525 |

Source records: OpenFootball **3,205**, StatsBomb **83**, TheSportsDB **12**. Coverage includes EPL 2025–26/2026–27, Saudi 2024–25, Champions League, Europa/Conference qualifying, Copa Libertadores, Copa Sudamericana, World Cup 2026, AFCON, women's Euro, Bundesliga and Belgian fixtures. Published coverage varies; AFCON 2026's imported file contains 16 knockout matches, and UEFA qualifying files do not imply full main-tournament coverage.

272 exact mirror fixture pairs were reconciled while retaining both records. 16 kickoff disagreements remain visible. 34 ambiguous mirror matches, eight entity candidates and six social accounts remain in the verification queue. The fixture-group count is therefore not a claim that every remaining alias has been resolved.

One pre-match snapshot was captured; 118 earlier/unverified-time windows are explicitly marked missed. No old data was backdated. Calibration reports **insufficient eligible data**, not validated accuracy. One official YouTube channel was corroborated through the club's own [published channel link](https://www.cambridgeunited.com/news/2023/september/fusion-josh-cambridge-united-collaboration-youtube-sky-bet-league-one-efl-english-football-league-september-2023).

## Sources

Working without registration: **OpenFootball, Wikidata, TheSportsDB public development API, StatsBomb, BBC RSS and Guardian RSS**. TheSportsDB's public responses are limited and sometimes return a sample set rather than the requested league; returned teams are not assigned to an unverified league. Player coverage remains limited.

Internet Archive availability returned **HTTP 429**. Its backoff is persisted and daily maintenance can retry; no protection or rate limit was bypassed.

Optional free registration/credentials: **football-data.org**, **API-Football**, **YouTube Data API**. API-Football usage is **0/100**, since no key is configured. Widgets have a verified cache-only fallback and cannot expose the server credential or bypass the quota. Their populated live view cannot be verified until eligible cached API-Football data exists. The implementation follows the provider's [custom data URL documentation](https://www.api-football.com/news/post/how-to-optimize-widgets-cache-and-security-tutorial).

Intentionally disabled automatic collection: unverified FIFA/UEFA/confederation pages/feeds; Instagram, Facebook and X APIs; Soccerway, WorldFootball.net, FootyStats, Flashscore and LiveScore. The registry records unknown/prohibited automation permission or the lack of a permitted free endpoint. These sites remain verification links. No full articles or inaccessible post text were invented, and no media was rehosted.

## Validation and automation

- **48 automated tests passed**: regression, provider contracts, migration/idempotence, deduplication, provenance, disagreements, quotas, caching/backoff, scheduling, snapshots, leakage, calibration and API/service workflows.
- **TypeScript passed. Production build passed.**
- **Chrome desktop (1440×1000) and mobile (390×844) checks passed**: new navigation, classic views, match/entity pages, mobile overflow and preserved basketball interaction. External requests and synchronization were blocked in browser tests.
- Local mutation protection returned **403** for a foreign Origin. The official widget gateway returned a correct empty-cache response with no provider call.
- Three Windows tasks are installed and enabled with staggered starts, limited privileges, hidden consoles and failure retries. The fixtures task was executed and completed successfully: fixtures, results and snapshots all returned HTTP 200. Fixture/result updates run every 30 minutes, news/social hourly, and discovery/history/reconciliation/calibration/retention/backups daily. Imported OpenFootball files rotate within the request budget.
- Final database backup: `.sites-runtime/backups/football-2026-09-11T02-42-57-381Z.sqlite`. Logs: `.sites-runtime/updates.jsonl`. Raw audit: [outputs/final-data-audit.json](outputs/final-data-audit.json).

Screenshots: [desktop](outputs/football-desktop.png), [mobile](outputs/football-mobile.png).

## Remaining limits and account steps

This is a working local intelligence platform with incremental coverage, not a complete official global live feed. Free sources do not guarantee current seasons, all players, injuries, lineups, standings or social posts. Date-only kickoffs remain timezone-unverified. Ambiguous identities need evidence review; calibration needs additional future observations and outcomes. Scheduled updates require the Windows user session and an awake computer. Provider availability and quota limits can defer individual jobs without blanking cached pages.

**Nothing is required from you to use the keyless system.** For optional coverage, register for free accounts at [football-data.org](https://www.football-data.org/), [API-Football](https://www.api-football.com/), or [Google Cloud/YouTube Data API](https://developers.google.com/youtube/v3/getting-started), and provide `FOOTBALL_DATA_KEY`, `API_FOOTBALL_KEY`, or `YOUTUBE_API_KEY` in `.env.local`. No paid account or automated account creation is required. [INTELLIGENCE.md](INTELLIGENCE.md) contains commands and operational details.
