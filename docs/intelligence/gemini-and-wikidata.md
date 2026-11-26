# Gemini explanations and Wikidata logo identities

Written for maintainers. Decision recorded on 2026-11-26.

## Why there is no Gemini search grounding
The Gemini API Additional Terms (effective 23 March 2026) say that Grounded Results and Search Suggestions:
- may not be cached, analysed or used to create a database;
- may be shown only to the end user who submitted the prompt, together with the Search Suggestions;
- may not have their links collected by automated means.

The pricing page lists Grounding with Google Search on Gemini 3.x as "Not available" on the free tier. A background engine that stores lineups, injuries, news or logos found through search and shows them to every visitor is therefore not used.

## What Gemini does here
- **Stage `ai-explain`** (three-hourly job): for tracked pre-match forecasts kicking off in the next 48 hours, it asks Gemini for 2–4 short points that explain the forecast. The prompt contains only facts that Mnemba recorded: the model's probabilities, expected goals, recent form, goals per match and head-to-head counts.
- **No `tools` field:** no Google Search grounding.
- **Validation:** every point must cite fact ids. Every number in a point must be one of the supplied values. Certainty words are rejected. Anything that fails is discarded.
- **Display:** the match page's Analysis details shows the explanation only for the exact saved forecast it explains, labelled as written by Gemini.
- **Limits and switches:**
  - Calls use the `gemini` source in the source registry, which provides spacing, 429 backoff and the admin enable switch.
  - `GEMINI_DAILY_REQUEST_LIMIT` is enforced locally as well (default 100, maximum 1,000).
  - `GEMINI_PAID_USAGE_ALLOWED` must be `false`.
  - Use a key from a project without billing, so free-tier usage cannot be charged. Free-tier prompts may be used by Google to improve its products, so the prompts contain only public match data.

Environment for `mnemba-update-1`:
- `GEMINI_API_KEY`: the secret `gemini-api-key`;
- `GEMINI_ENABLED=true`;
- `GEMINI_MODEL`: a model you confirmed in Google AI Studio is free for your project;
- `GEMINI_PAID_USAGE_ALLOWED=false`;
- `GEMINI_DAILY_REQUEST_LIMIT=100`.

## Wikidata identity matching (logos)
- **Stage `wikidata-match`** (three-hourly job, 12 entities per run, soon-playing first): it covers teams and competitions with a verified identity but no permitted logo source. It searches Wikidata (CC0) through the `wikidata` source and its daily budget of 150 requests.
- **A link needs all of these:**
  - the right Wikidata type;
  - the right country, matched against the competition's ISO code or exact country name;
  - an exact normalised name or alias match;
  - no women's, youth or reserve mismatch;
  - exactly one surviving candidate.
- **Effect of a link:** it adds a verified `wikidata:Q…` alias to the entity's canonical identity, without ever moving a Q-id already used elsewhere. The media stage then fetches the Wikidata logo claim (P154) from Wikimedia Commons with its existing licence checks.
- **Unresolved cases:** each outcome is stored in `wdmatch:<entity>` (linked, no-match, ambiguous, conflict, skipped) with its reason.

## Status and controls
- **Status:** `GET /api/intelligence?view=intelligence-status` (internal token). It shows the Gemini state and model, requests today against the limit, the last run, stored and rejected explanations, Wikidata match states and logo coverage. Credentials are never returned.
- **Switch a module off or on:** `POST /api/intelligence` with `{"action":"source-policy","id":"gemini"|"wikidata","enabled":false|true}` and the internal token.

## OpenAI pre-match research (stage `research`, hourly job)
- **Purpose:** web research with the Responses API `web_search` tool, for fixtures in the next 48 hours. It looks for confirmed or predicted lineups, injuries, suspensions, doubtful players, rotation, managerial changes and congestion. Each finding must carry a URL the response actually cited. OpenAI's web-search guide requires inline, clickable citations wherever web information is shown, and the "Team news" panel does that.
- **Lineup rules:**
  - "Confirmed" needs 11 distinct starters per team, a cited source, and publication within 6 hours of kickoff. Anything else is "predicted" (when sourced) or dropped.
  - Earlier matches' lineups are never accepted.
- **Priority:** first, lineups for kickoffs 30–100 minutes away without a confirmed lineup. Then availability for fixtures with no record, or one older than 24 hours, soonest first. Requests are batched by competition. The batch size starts at 5 and adapts between 3 and 10 based on measured completeness. Requests send what is already known and ask only for changes.
- **Cost controls:**
  - Model `gpt-4o-mini`, with `search_context_size: low`, `max_tool_calls` set to 3, bounded output and `store: false`.
  - A micro-USD ledger (`source_request_usage`, source `openai`, key `spend-total-usd-micro`) reserves the worst case before each request and settles to the reported usage plus billed search actions afterwards.
  - Hard cap of $5 (`OPENAI_BUDGET_USD` cannot raise it), plus a daily slice (`OPENAI_DAILY_BUDGET_USD`, default $0.75) and a per-run limit (`OPENAI_MAX_REQUESTS_PER_RUN`, default 3).
  - Prices assumed: web search $10 per 1,000 calls, plus 8,000 input tokens per call at $0.15 per million.
  - Also set a project budget limit in the OpenAI dashboard and keep auto-recharge off.
- **Probabilities:** research is context only and does not change them. An adjustment needs chronological, out-of-sample evidence first.
- **Basketball:** not covered. `/basketball` is a labelled demo studio with no real fixture source.

Environment for `mnemba-update-0` (hourly):
- `OPENAI_API_KEY`: the secret `openai-api-key`;
- `OPENAI_ENABLED=true`;
- `OPENAI_MODEL=gpt-4o-mini`;
- `OPENAI_BUDGET_USD=5`.
