# Mnemba Tips public experience upgrade

Implemented in the existing Linux Codespaces repository on 12 September 2026.
The previous football imports, estimates, provenance and internal basketball
engine/tests are preserved. No deployment, paid service or account was created.

## Running product

Open **http://localhost:5173/football**, or forwarded Codespaces port 5173.
The root route opens the real product. `/lab`, `/football/classic` (including
old query strings), `/football/admin` and `/football/predictions` redirect there.

Public navigation now contains Predictions, Fixtures, Leagues, Teams & Players,
and News. The mobile layout exposes all five items without hiding News offscreen.
The existing slideshow, original stadium imagery and navy/green identity remain.

Restart:

```sh
node scripts/setup-internal-access.mjs
npm run dev -- --host 0.0.0.0
# In a separate terminal:
npm run schedule
```

The setup command creates an ignored local control credential if missing; it does
not print its value or replace existing secrets. Only one app worker may own the
SQLite database. Stop preview before `npm run build` / `npm start` (port 8787).
Automatic updates pause while the Codespace or scheduler is stopped.

## Implemented and verified

- Removed public demo, basketball studio, diagnostics and standalone social links.
  Preserved the demo component internally and the basketball calculations/tests.
  The demo prediction API returns HTTP 410 instead of artificial predictions.
- Internal reads (`sources`, `files`, `evidence`, `social`, `diagnostics`, model
  performance) and administrative writes require a private bearer credential.
  Localhost and forged user headers do not authorize access. Browser match refresh
  remains available with same-origin checking and existing source quotas/leases.
  Internal scripts authenticate; no administration dashboard is exposed.
- Added Today’s Match Insights, preferring eligible persisted estimates across
  competition groups. Empty accuracy marketing is gone; no fabricated accuracy,
  confidence or popularity is substituted.
- Browser-local timezone preference with an optional IANA-zone override stored
  only in that browser. Shared links do not carry another user's preference.
  Fixture cards, slideshow, matches, search, profiles and articles use the shared
  formatter. Today/date filters use local calendar boundaries, including DST.
  Unknown source times remain “Kickoff time to be confirmed.”
- Historical match pages omit all-zero reconstructed rankings. Empty predicted
  lineups and undated membership lists are no longer presented as match squads.
  Player pages distinguish recorded appearances and dated association history;
  open-ended membership is not confirmation of a current squad or lineup.
- Players have a dedicated `/football/players` page and visible search category.
  All nine requested targets are persisted: Messi, Cristiano Ronaldo, Mbappé,
  Haaland, Salah, Kane, Bellingham, Vinícius Júnior and Saka. Search handles accents
  and typos; `Mbappe` and `Mbape` both find the correctly accented identity.
- News pages have internal reading layouts, original illustrative lead artwork,
  publisher/time attribution, related clubs/players, contextual fixture links and
  related reporting. Feed descriptions remain brief when the source is brief;
  longer reports are not invented from a headline.
- Three recent official FC Barcelona video briefings were imported from the
  publisher's Atom feed. The channel is corroborated by the club's official site;
  oEmbed verifies the publisher and enabled player. The page loads a dedicated
  privacy-enhanced YouTube player on request, with fullscreen and a fallback link.
  No restricted media is downloaded, transcribed or rehosted.

## Real imports and coverage

| Record | Before | After |
| --- | ---: | ---: |
| Distinct fixtures | 6,817 | 7,429 |
| Retained fixture source records | 7,469 | 8,081 |
| Teams | 666 | 668 |
| Player identities | 180 | 190 |
| News records | 220 at previous release | 226 |
| Badge mappings verified by conservative identity matching | — | 25 / 668 |

Imported **306 fixtures from 2020–21 Bundesliga and 306 from 2021–22**.
Both imports returned successful inserted/unchanged counts, with no failed files.
The ten new player records include a real same-name footballer encountered during
Salah disambiguation; nine named target identities are individually verified.
No current clubs, injuries, photos or statistics were invented.

The previous SportsDB team adapter used undocumented `lookup_all_teams.php`, which
returned the same unrelated English League 1 data for different league IDs. It now
uses documented `search_all_teams.php`, checks identities conservatively, and
retains separate metadata rather than merging fixture identities by name.
Country checks and distinguishing suffixes prevent Barcelona SC receiving
FC Barcelona's badge. Only 25 mappings meet the checks; **643 remain placeholders**.
Browser image loads were verified for Arsenal, Augsburg, AC Milan and Barcelona,
representing four leagues. Club marks are unmodified, provider-linked and attributed.

The free source currently limits team lists to ten records per request. This is
partial development coverage, not a claim of universal badge availability or a
license to redistribute every club mark. See [TheSportsDB documentation](https://www.thesportsdb.com/documentation)
and [terms](https://www.thesportsdb.com/docs_terms_of_use.php).
Player facts use [Wikidata's CC0 structured data](https://www.wikidata.org/wiki/Wikidata:Licensing).

## Browser and data evidence

The same real fixture (`thesportsdb:2398076`) displays:

| Browser timezone | Local kickoff |
| --- | --- |
| America/New_York | 14 September 2026, 18:00 GMT−4 |
| Africa/Dar_es_Salaam | 15 September 2026, 01:00 GMT+3 |
| Europe/London | 14 September 2026, 23:00 BST |

Isolated, non-persisted browser responses also exercise midnight crossings and
spring/autumn DST dates. Unit tests verify 23-hour and 25-hour local days. Source
date-only fixtures are never assigned a manufactured exact instant for display.

Frankfurt–Bayern regression: imported 2022–23 Matchday 1, provider ID
`openfootball:dd41a4242834f73cd8ec1f3bdc1c5590c3cca54b7e858011a5dd17ad410bb202`.
It now has ten earlier form matches per team, no retrospective predicted XI,
and zero displayed table rows at the season-opening cutoff.

Examples of eligible home/draw/away estimates at verification:

- Crystal Palace–Ipswich: 40.0% / 21.4% / 38.6%.
- Hoffenheim–Stuttgart: 25.2% / 18.7% / 56.1%.
- Bochum–Greuther Fürth: 54.5% / 22.9% / 22.7%.

These are saved model estimates, not measured accuracy or betting guarantees.
Exact timestamps and fixture IDs are in `outputs/page-upgrade/release-evidence.json`.

Screenshots in `outputs/page-upgrade/`:

- `before-desktop.png`, `before-mobile.png`: previous verified release.
- `after-desktop.png`, `after-mobile.png`: improved public workspace.
- `historical-mobile.png`, `player-mobile.png`, `news-mobile.png`.
- `badge-Arsenal.png`, `badge-FC-Augsburg.png`, `badge-AC-Milan.png`,
  `badge-FC-Barcelona.png`.
- `video-mobile.png`: actual publisher player loaded inside the article.
- `video-playing.png`: playback attempt showing the external sign-in challenge.

## External limits and unfinished coverage

**YouTube playback is externally blocked in this Codespaces browser.** The real
player, thumbnail and publisher controls load, but clicking play results in
“Sign in to confirm you’re not a bot”; playback remains paused at time zero.
No challenge bypass was attempted. The original-video fallback remains visible.
Embedding follows [YouTube's documented player options](https://support.google.com/youtube/answer/171780?hl=en);
the [club's official site confirms its YouTube channel](https://www.fcbarcelona.com/en/club/news/4340606/barca-surpasses-fifa-and-the-nba-reaching-238-million-subscriptions-on-youtube).

Current squads, complete season statistics, confirmed lineups and badges are not
universally available. Historical associations are shown with their date limits.
The existing optional live/statistics credentials remain optional; this upgrade
added no paid dependency. No full-text article rights were assumed.

Repository-wide lint still fails; rules were not weakened. The previous release
had 82 errors and 9 warnings; the final count for this upgrade is recorded below.

## Commands and checks

- `npm run typecheck`: pass.
- `npm run test:unit`: pass (5 files, including internal basketball calculations).
- `npm run test:system`: pass (13 files, including seven public-experience cases).
- `npm run test:browser`: pass for public journeys, redirects/access denial,
  images, mobile overflow, player search, historical match and timezone/DST cases.
- Public refresh: HTTP 200 with cached context and explicit unavailable-provider
  reasons; it does not pretend missing details were retrieved.
- `npm run lint`: 79 errors / 9 warnings; remains unfinished.
- `npm run build`: pass; final production bundles and routes compiled.

Principal changes: `components/intelligence-workspace.tsx`, `local-time.tsx`,
`public-nav.tsx`, `team-badge.tsx`, `global-search.tsx`, `football-entity.tsx`,
`match-center.tsx`, `news-briefing.tsx`, `featured-matches.tsx`; public routes and
API access gates; `lib/football/access.mjs`, `timezone.mjs`, `public-enrichment.mjs`,
`video-news.mjs`, `media.mjs`, plus existing service/search/consumer adapters;
internal scheduling/import scripts and browser/system verification.


Final runtime handoff: preview is listening on `0.0.0.0:5173`. The scheduler was
restarted to load the new internal credential; its due fixtures/results/models/
snapshot jobs returned HTTP 200 and successful outcomes. Jobs not yet due were
skipped. The continuous scheduler remains running. The local origin helper now
prefers the active IPv4 listener while retaining IPv6-localhost compatibility.
The final browser suite passed after restart, including saved timezone override,
return to local time, and image loads for four representative leagues.

No extra migration was necessary for this upgrade; the existing tables store
player facts, memberships, metadata cache and articles. The database backup before
these imports is `.sites-runtime/backups/football-2026-09-12T09-01-06-427Z.sqlite`.
