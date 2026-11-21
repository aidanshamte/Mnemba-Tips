# 5DollarFootballAPI (Pro): capability matrix

Sources:
- The provider's documentation at <https://5dollarfootballapi.com/docs>, read 2026-11-21.
- Authenticated Pro responses observed in production, 2026-11-20 and 2026-11-21. Each "Observed" note below is from a live response, not from the documentation.

The key is server-side only: the Azure secret `fdfa-api-key`, exposed as `FIVE_DOLLAR_FOOTBALL_API_KEY`. Adapter: `lib/football/fivedollar.mjs`.

## Account (observed through `/v1/status`)
- **Plan and limits:** Pro, 10 requests per 60 seconds, per account. `daily_limit` is null.
- **Rate-limit headers:** `X-RateLimit-Limit`, `-Remaining` and `-Reset` (a unix timestamp at a minute boundary). A 429 response carries `Retry-After`.
- **History:** Pro returns 12 months.
- **Data rights:** the docs allow commercial use, display and caching. Resale or redistribution of the raw feed is prohibited. Attribution is optional on Pro.

## Request discipline (as implemented)
- **Rate cap:** 9 requests per clock minute, shared through `source_request_usage`, plus a 6.5-second gap between requests.
- **Backoff:** `Retry-After` is honoured, with exponential backoff.
- **Circuit breaker:**
  - 3 consecutive failures open it for 15 minutes, doubling up to 2 hours;
  - a 401 or 403 opens it for 6 hours.
- **Per-run budgets:**
  - 8 requests per core run and 12 per details run;
  - time boxes of 75 seconds (core) and 60 seconds (details);
  - no request within 45 seconds of the run deadline.
- **Schedule:** provider stages run after every existing stage.
- **Caching:**
  - the league catalog for 24 hours;
  - standings per league for 24 hours;
  - finished-day windows for 3 to 12 hours;
  - history per league for 7 days.
- **Emergency switch:** `MNEMBA_FDFA_DISABLED=1` on a job. The "Request discipline" section of `infra/azure/README.md` has the commands.

## Endpoints

| Endpoint | Pro | Parameters used | Pagination | Freshness (documented) | Cost | Stored in | Schedule | Used by |
|---|---|---|---|---|---|---|---|---|
| `/v1/status` | yes | none | none | today's usage | 1 | not stored | manual checks | operations |
| `/v1/leagues?include=seasons` | yes | `per_page=100`, `page` | `has_more` | not stated | 2 (169 leagues observed) | `fdfa:leagues`, `fdfa:catalog-map` | 24 h | identity mapping, catalog report |
| `/v1/fixtures` (window up to 24 h, `[start,end)`) | yes | `status=live\|finished\|scheduled`, `include=events,stats,odds` (`per_page` up to 50), `per_page` up to 100 (500 when live) | `has_more` | live data is "written continuously" | 1 per page | `fixtures`, `fixture_events`, `fixture_statistics`, `odds:*` | core: live, today's finished, yesterday's finished, next 24 h, days +1 to +6 in rotation. Details: events, statistics and odds for recent finished matches, odds for the next 24 h | fixtures, live status, results, grading |
| `/v1/leagues/{id}/fixtures` | yes (12 months) | `status=finished`, `start_time`, `end_time` (no 24 h cap), `order=desc`, `per_page=100` | `has_more` | not stated | 1 per page; at most 6 pages per league | `fixtures` | leftover budget; served by soonest upcoming fixture; once per 7 days per league | team history for forecasts, identity evidence |
| `/v1/standings?league=&type=total` | yes | `league`, `type` | none | not stated | 1 | `standings` (label "Provider standings") | 2 leagues per details run, 24 h cache | competition page table |
| `/v1/fixtures/{id}`, `/events`, `/statistics`, `/odds` | yes | none | none | not stated | 1 each | not used separately | n/a | replaced by `include=` on listings (batching) |
| `/v1/teams/{id}`, `/v1/teams/{id}/fixtures` | yes | none | `has_more` | not stated | n/a | not used | n/a | the team object is `{id, name}` only; league history covers form |
| `/v1/countries`, `/v1/bookmakers` | yes | none | none | not stated | n/a | not used | n/a | country names arrive with each league |
| `/v1/fixtures/{id}/odds/history` | **no** (Ultra and above) | none | none | n/a | n/a | not used | n/a | n/a |
| `/v1/chinasportslottery` | **no** (Ultra) | none | none | n/a | n/a | not used | n/a | n/a |
| `include=odds_full` | **no** (Business) | none | none | n/a | n/a | not used | n/a | n/a |

## Returned fields and data-quality notes
- **Fixtures** carry:
  - `id`, `league{id,name}`, `teams.home/away{id,name}`;
  - `kickoff_utc` and `kickoff_ts`;
  - `status`: scheduled, in_play, finished or unknown;
  - `status_reason`: null, kickoff_unconfirmed or result_unconfirmed;
  - `status_code`: a minute, "half" or "full";
  - `goals` and `corners`, each with half-time values;
  - `cards.home/away{yellow,red}`.

  Settlement rules:
  - A result settles only on an unqualified `finished` status.
  - A fixture still unconfirmed 4 hours after kickoff becomes `unknown`.
  - Cup-style competitions are not graded from this provider alone, because the score may include extra time.
- **Events:**
  - The documented types are goal, corner, yellow_card, red_card, substitution, missed_penalty and period_score.
  - Substitutions carry `player_in` and `player_out` as **name strings only**, with no player IDs.
  - Observed in production: goal, corner, yellow_card and period_score.
- **Statistics:** attacks, dangerous attacks, shots on and off target, and possession, each with a first-half breakdown.
- **Standings:**
  - Observed rows: `position`, `team`, `played`, `win`, `draw`, `lose`, `goals_for`, `goals_against`, `goal_difference`, `points`, and `source` "feed".
  - The documentation instead shows `total_for`, `total_against`, `average_for` and `average_against`. The normalizer accepts both spellings.
  - 119 of the 169 leagues report `has_standings`.
- **Odds:** bet365 on Pro, with opening, closing and in-play values for 1x2, Asian handicap, goal line, corner line, corner Asian, card line, card Asian and half-time variants. They are stored as evidence only and are not shown as advice.
- **Seasons:** for example "2026" or "26/27". Exactly one is current.

## Not offered by this provider (documented as absent on every plan)
None of the following is offered, so it is shown as unavailable rather than invented:
- lineups and formations;
- players and squads (substitution names only);
- player photographs;
- team crests;
- competition artwork;
- referees;
- venues;
- injuries and suspensions;
- a dedicated head-to-head or form endpoint;
- team season statistics;
- incremental "updated since" parameters;
- webhooks.

Existing permitted sources (Wikidata, Wikimedia Commons, TheSportsDB, OpenLigaDB, OpenFootball, LiveScore) continue to supply what they can.
