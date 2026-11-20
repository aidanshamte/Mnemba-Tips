# Local media and page improvements — 13 September 2026

Local URL: http://localhost:5173/football

This pass used the populated local database and existing authorization, update locks and provider budgets. No deployment, GitHub push, remote D1 query or production Worker operation was performed. Backups were taken before the media work; see `outputs/media/backup.log`. Existing prediction history, fixtures and basketball were preserved.

## Delivered

- News cards now select attributed article-specific RSS media, permitted supplied Open Graph metadata, official video thumbnails, verified entity imagery, or publisher-branded placeholders. The generic stadium fallback is removed from news. Summaries are limited to 280 characters and two lines on cards. Failed images advance to the next permitted option.
- Internal articles have responsive click-to-load privacy-enhanced YouTube/Vimeo players, poster images, accessible controls and original-source fallback links. Only explicitly permitted, article-associated embeds are accepted. Current imported videos are official FC Barcelona YouTube items; Vimeo is allowlist-tested, not represented as an imported source.
- A normalized URL-deduplicated registry records exact entity associations, source, usage basis, attribution, verification/load timestamps and available dimensions. Only verified canonical aliases share media. FC Barcelona and Barcelona SC remain distinct. Unknown dimensions remain null.
- Local incremental enrichment verifies existing provider badges and exact Wikidata P154/P18 claims against Commons license/creator metadata. Four entities or news images are checked per job. URL checks cache successes, back off failures and timeouts, and stop repeated requests to hosts returning 403/429. Metadata and URLs are stored; no image binaries were downloaded into the app database.
- Visual search uses badges or shield monograms, portraits or initials with “Photo unavailable”, recorded country/competition context, concise actions, loading states and existing typo search/pagination. Late asynchronous media cannot leak into a different entity result.
- Match pages retain the main prediction and strongest supported option; detailed model reasoning, markets, form, standings, lineups and source evidence are expandable. The mobile header is more compact. Missing genuine forecasts remain clearly unavailable.

## Measured local coverage

| Item | Verified/permitted media | Fallback |
| --- | ---: | ---: |
| Teams | 25 / 795 verified badge mappings | 770 |
| Players | 0 / 190 verified portraits | 190 |
| News | 132 article-specific image records + 3 video posters / 274 stories | 139 publisher placeholders |

Eight articles have authorized embed metadata; three currently have poster metadata. These overlap the news total. Twenty-five team associations use 23 distinct badge URLs. Four publisher images were additionally HEAD-verified and registered during the end-to-end news-media job. Twelve sampled news-card images loaded in the browser; metadata coverage is not a claim that every external image was browser-tested.

Five Commons thumbnail URLs returned HTTP 403. Wikidata subsequently returned HTTP 429, and provider backoff was retained. No portrait from these failed loads was marked verified. At the report snapshot, the entity queue contained 25 verified, 27 failed/deferred, 5 skipped and 928 pending records. There were zero stored rejected RSS image URLs. These counts describe records, not unique rejected providers. Full failed URLs, queue states, publisher and usage-basis distributions are in `outputs/media/coverage.json`.

## Verification

- `pnpm typecheck`: passed.
- `pnpm test`: passed (5 unit files, 18 system files). The media file contains 9 passing cases, covering canonical alias verification, Barcelona separation, player identity, source/license checks, safe media selection, disabled embeds, summary length, deduplication and network-failure backoff. Existing search tests cover pagination and typo matching.
- `pnpm build`: passed; final build log in `outputs/media/build.log`.
- `pnpm test:browser`: passed. Includes basketball, navigation, admin access denial, search, club badges, news, historical-match integrity, responsive layout and timezone/DST checks.
- `scripts/browser-media.mjs`: passed desktop and mobile checks for Augsburg, Arsenal, both Barcelonas, Bayern München, Messi, Mbappé and Salah; no page errors or horizontal overflow. Browser-only broken badge injection falls back to a monogram. Loaded images have descriptive alt text. This is targeted accessibility verification, not a complete accessibility certification.
- `scripts/verify-local-mode.mjs`: passed local page/API/history checks with the loopback permission required by this environment.
- `pnpm lint`: remains failing: 82 errors and 14 warnings across the workspace, including existing broad typing/hook-rule debt. Typecheck/build success does not imply lint is clean.

Actual YouTube playback was attempted: the embedded player loaded, then displayed “Sign in to confirm you’re not a bot”; playback time remained zero. Therefore in-app playback acceptance cannot be claimed in this environment. The original publisher link remains available. No bypass was attempted.

## Screenshots

- [Desktop news](outputs/media/news-desktop.png)
- [Mobile news](outputs/media/news-mobile.png)
- [Mobile search](outputs/media/search-mobile.png)
- [Desktop Arsenal search](outputs/media/search-Arsenal.png)
- [Mobile match](outputs/media/match-mobile.png)
- [Video player and provider challenge](outputs/media/video-desktop.png)

## Operation and remaining limits

The single local preview and foreground local scheduler are left running. They stop when the Codespace/session stops. `pnpm media:enrich` runs bounded entity and news-media updates; `node scripts/report-media.mjs` refreshes the read-only local report. Scheduler output is in `outputs/media/scheduler.log`. All use the existing local credentials and locks.

Badge and portrait coverage remains incomplete. No name-only or uncertain identity was assigned an image. Missing current-club information is not inferred. Open Graph selection accepts explicitly permitted supplied metadata; no unrestricted article crawler was introduced. Additional official press-kit sources require their permission and exact identity records. Commons file licenses are checked individually; club marks retain their owners’ rights. Source references: [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia), [MediaWiki image metadata API](https://www.mediawiki.org/wiki/API:Imageinfo), [YouTube player parameters](https://developers.google.com/youtube/player_parameters).
