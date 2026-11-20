# Football visual identities — local checkpoint, 21 September 2026

This feature extends the existing media registry, aliases, badge component and enrichment job. No migration, new provider, model change, basketball change, Azure job change or Azure deployment was made. Include these changes in the next normal release.

## Current local database audit

| Identity records | Total | Permission-cleared real logos | Neutral fallback | Missing visual | Real-logo gaps |
|---|---:|---:|---:|---:|---:|
| Teams | 1,286 | 0 | 1,286 | 0 | 1,286 |
| Competitions | 68 | 0 | 68 | 0 | 68 |

Counts are database provider identity records, not a claim that every alias is a distinct club or league. Existing provider-linked badge mappings remain stored, but a link and a successful HTTP check do not establish image-specific public-display permission. Those mappings are excluded from the new public logo resolver. The previous reports' broader “verified registry” counts are therefore not equivalent to the stricter counts above.

A bounded local enrichment attempt used the existing source clients and quotas. The two persisted Wikidata club IDs (Eintracht Frankfurt and FC Augsburg) returned no eligible logo claim. Missing identities were not guessed from names; Tanzania and all other uncovered entities receive the same neutral visual treatment. Competition enrichment now uses the existing media tables and checks logo claims and Commons licenses when an exact identity is available. No bulk image search was performed.

## Shared implementation

- `lib/football/visuals.mjs`: team/competition resolvers, permission checks, verified-alias handling, safe fixture-context matching, one-minute server metadata cache and audit.
- `components/football-identity.tsx`: shared team/competition identities, neutral inline SVG initials, one deduplicated metadata request per page, lazy real-image loading, viewport-aware timeout and broken-image fallback. Raw provider image URLs cannot bypass the registry. The existing `team-badge.tsx` delegates to this component.
- `/api/intelligence?view=visuals`: already-resolved metadata only; no upstream requests on page views. Source, source entity, attribution, license/permission and last check remain available. `/football/visual-credits` exposes attribution links.
- Existing match cards/carousel/ticker, match details/live updates, standings, head-to-head, lineups, league picker/pages, search, team/player club references, prediction history, saved picks, classic football workspace, related news references and coverage use shared visuals. Native HTML option text and quoted article prose are not rewritten into images.
- Search and saved-pick read responses now expose existing team identities for display; saved forecast and shortlist payloads are not edited.

## Verification

Four targeted identity tests pass, including unknown permission rejection, verified aliases, wrong-team prevention, conflicting fixture IDs, image-type filtering, URL failure handling and metadata deduplication. Seven relevant regression files passed (visuals, media, search, public experience, saved previews, release and live delivery). TypeScript and the production build pass. New-module lint has no errors; one existing-style native-image performance warning remains intentional because licensed source images use native lazy loading without rehosting.

Regional browser checks pass Tanzania, Premier League, La Liga, Bundesliga, Serie A, Champions League and MLS. CAF is checked as a coverage fallback, not falsely claimed as imported fixtures. Browser-only synthetic metadata verifies real-image preference, failed/timeout image handling and one metadata request for many badges. No synthetic logo records were written to the database.

Final desktop/mobile page regression passes football, fixtures, search, match details, history, news, player profiles, basketball scenarios and the legacy lab redirect. The final Tanzania check also asserts readable badge contrast on the match hero. `git diff --check` passes.

The development worker repeatedly dropped match-context requests. Verification uses the local Azure/Next runtime and the existing isolated PostgreSQL clone; the full application is not redeployed to work around a development-runtime issue. The historical clone can have no matches for today's date, so the page regression explicitly allows that empty-day condition. Protected evidence: `.sites-runtime/visual-identities/`.

The verified local preview runs at `http://localhost:5183`, with scheduled updates disabled and the isolated `local_verified` PostgreSQL schema. The development preview on port 5173 was stopped. Production and its scheduled jobs are unchanged.

## Remaining source gaps

Image-specific public-display permission and exact identities are still missing for the real-logo gaps above. TheSportsDB links alone are not accepted as permission. Wikidata is an identity source, not a license for linked artwork. Only appropriate Commons file licenses or an explicit recorded display grant may enable a real logo. Fallback badges are Mnemba graphics and do not imitate official crests.
