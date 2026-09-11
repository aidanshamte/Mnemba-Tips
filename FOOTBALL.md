# Global football workspace

Open `/football` for fixtures, live snapshots, competition discovery, team/player search, verified news and local diagnostics. The original two-sport Prediction Lab remains at `/`; its scenario datasets and basketball model are preserved.

## Local setup

Copy `.env.example` to `.env.local`, then fill `API_FOOTBALL_KEY` and/or `FOOTBALL_DATA_KEY`. Credentials are server-only. Wrangler loads `.env.local` into local Worker bindings; restart after changing credentials. Do not put secrets in public environment variables, source, command arguments, Cloudflare configuration or the database. `NEWS_API_KEY` is optional and is used only when the runtime is in development mode. It is ignored in a production build.

Run `pnpm dev` for development. Run `pnpm test`, `pnpm exec tsc --noEmit`, then `pnpm build` and `pnpm start` for the local production preview. The preview binds to loopback. D1 state persists under `.wrangler/state`. Football tables initialize through an additive, idempotent migration on first use. `node scripts/football-migration.mjs` exports the same statements to `drizzle/0001_global_football.sql` for inspection or external migration tooling. Do not delete local database state to reset quota accounting.

## Data and provenance

- [API-Football v3](https://www.api-football.com/documentation-v3): primary global catalogue, countries, seasons, coverage, fixtures and covered details. Every returned competition is eligible; featured names classify returned records rather than create clubs or fixtures.
- [Football-Data.org v4](https://www.football-data.org/documentation/quickstart): its own supported catalogue and season calendars, teams, standings and scorers, plus fallback fixture synchronization when the primary fails or reaches quota. A persistent 6.5-second request slot limits bursts. Plan-restricted detail endpoints return an unavailable state.
- [OpenFootball](https://github.com/openfootball/football.json): GitHub tree discovery and selected completed-result imports, public domain. The original `/api/open-data` endpoint is retained.
- [StatsBomb Open Data](https://github.com/statsbomb/open-data): dynamic competition-season discovery, selected completed-result imports, and historical lineups, significant events and shot-derived statistics on demand. Follow the dataset attribution and usage requirements. Date-only or timezone-unspecified source data is marked with its source precision.

Provider IDs are namespaced. `football_teams` and `football_players` isolate global-provider entities from the existing `teams` and `players` scenario/basketball tables. Foreign keys tie seasons, competition memberships, fixtures, details and prediction results together. No fuzzy club-name merges are used across sources; equivalent fixtures can appear from two providers with their provenance visible. Historical imports cannot automatically augment another provider's team model without a verified identity mapping.

Values use Live, Confirmed, Provider prediction, PitchPredict model projection, Historical or Unavailable labels. Live means the provider's last snapshot, not a continuous feed. An absent injury report does not confirm fitness. Empty lineups are unavailable; projected XIs never populate the confirmed-team-sheet table.

## Budget and lifecycle

API-Football attempts are reserved with a conditional SQLite write **before** network access. Failed calls and retries count. Daily UTC caps: live 48, fixtures 10, details 20, statistics 10, retry/manual pool 8, reserve 4. Automatic usage stops at 96 and each category also has a ceiling. The reserve is not automatically consumed. Provider-reported remaining quota can reduce the local allowance. Use a dedicated API key: requests made elsewhere before the application observes a provider quota header cannot be counted locally.

The browser sends a local heartbeat every 30 seconds while visible. Each heartbeat runs at most one due job. Global live fixtures are due every 30 minutes **only when cached live matches exist**; the selected live match is due every 5 minutes. Today is due every 6 hours, upcoming fixtures and selected season calendar/standings every 12 hours, team/player/statistics/scorers daily, injuries every 6 hours, lineups near kickoff and on demand, news every 3 hours, and historical catalog/imports weekly. Manual refresh is throttled to at least 5 minutes. A durable global lease with renewal prevents duplicate jobs across tabs and Worker instances. Temporary errors back off, preserve cached data and record diagnostics.

Closing or hiding the page stops heartbeat refresh. An already-started job may finish; no standalone daemon or remote cron continues spending requests. Cached GET responses never call sports providers. Administrators can inspect quota, UTC reset, provider configuration and sync failures at `/football?view=diagnostics`. Synchronization and diagnostics are restricted to localhost and same-origin browser requests; remote administration is intentionally not exposed.

Schedules are targets within the free quota, not guarantees. A 100-request daily plan cannot deliver every global fixture, lineup, player and live update at these intervals simultaneously. Global upcoming uses API-Football's next 99 fixtures; the explorer loads complete provider-returned competition calendars by season, subject to plan support. Fixture queries return up to 500 rows; narrow dates and competitions. Player pages and team statistics rotate daily for the selected season. Unsupported seasons remain visible with provider coverage flags, but requests may be refused by the account plan. Continent filters use returned provider geography and leave unmapped countries unavailable.

## News sources

Only metadata is stored: headline, publisher, exact publication time, original URL, a publisher-summary excerpt capped at 280 characters, and category. Full articles, NewsAPI `content`, and RSS `content:encoded` are never stored. HTML is rendered as text. No summaries or news are generated by AI.

| Publisher | Feed | Documentation / source page |
| --- | --- | --- |
| BBC Sport | `https://feeds.bbci.co.uk/sport/football/rss.xml` | [BBC RSS guidance](https://www.bbc.co.uk/sport/articles/cqllxj2n4kyo) |
| The Guardian | `https://www.theguardian.com/football/rss` | [Guardian feeds](https://www.theguardian.com/help/feeds) |
| UEFA | `https://www.uefa.com/rssfeed/news/rss.xml` | [Official UEFA news](https://www.uefa.com/uefachampionsleague/news/) |

UEFA's legacy RSS endpoint is availability-dependent and could not be verified as a current working feed during implementation. It is a fail-closed source: HTML, errors, redirects and invalid feed data are rejected and reported unavailable. The official news page remains the direct reference; no synthetic RSS or scraped full articles are substituted. BBC and Guardian feed availability is likewise checked at runtime. Article URLs must use HTTPS and match the publisher allowlist; unrelated hosts, spoofed suffixes, credentials in URLs, unverifiable timestamps and unsafe XML declarations are rejected. Canonical URL and headline similarity deduplicate displayed news. Categories are deterministic headline tags, not verified transfer/injury facts.

## Model and evaluation

The uncalibrated model derives chronological Elo, weighted recent results, home/away form, head-to-head results, rest and venue adjustment from cached completed matches. Available player minutes, performance, availability and confirmed or projected lineup strength supply additional signals. Recorded match appearances provide the last ten available player performances; season aggregates are explicitly labeled when match coverage is missing. Historical fixture statistics supply xG when at least three samples exist. Cross-competition matches allow an Elo-based competition-strength estimate; it remains unavailable without shared-team evidence. Missing inputs are explicitly omitted rather than invented. At least three historical matches per team are required.

Predictions are immutable versions written only before kickoff. Final results score each stored version with multiclass Brier score and winner accuracy. The diagnostics aggregate is across prediction versions, not a claim of out-of-sample calibration. Provider predictions stay separate and never become training truth. Lineup projection requires all eleven positional slots with recorded minutes and performance, and excludes known injured/suspended players.

## Validation

All automated provider calls use injected mocked responses; tests never call real APIs. Tests exercise both contracts, normalization, namespace isolation, SQL foreign keys and additive migration, duplicate upserts, persistent quota/concurrency/UTC reset, cache expiry, leases, fake-clock scheduler behavior, news allowlisting/deduplication, form, head-to-head, projected lineups, pre-kickoff prediction storage, result evaluation and a complete service/API workflow. Existing basketball/scenario tests remain in the test suite.
