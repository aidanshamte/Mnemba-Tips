# Mnemba Tips — Figma product design implementation report

Branch `figma/redesign` · final commit `d52f3a1` · 2026-11-20 · **local only: nothing pushed, merged or deployed**

## 1. Push result
- `fix/recovery-baseline` was pushed to `origin` at `ac6f6f3` (Phase 1). `figma/redesign` was fast-forwarded to `ac6f6f3` and then built locally.
- `figma/redesign` is **not** on the remote. `origin/main` is unchanged at `e6c3dd2`. No GitHub Actions were triggered.

## 2. Commits (on top of `ac6f6f3`)
| Commit | Scope |
|---|---|
| `77debeb` | Design foundations: tokens, self-hosted fonts, layout viewport |
| `fdd8836` | Shared components: tags, state panels, skeletons, neutral fallbacks |
| `e23501c` | Responsive navigation: desktop rail, top bar, bottom nav, sheets |
| `3be3d0c` | Fixtures, Home, Leagues and News screens |
| `df3f20c` | Match Predictions screen |
| `59124b5` | History, Saved picks, Competition and profile screens |
| `e5e35a3` | Search result rows |
| `c85a58a` | Figma Code Connect templates |
| `8fb2b32` | Responsive, dark theme and Figma comparison fixes |
| `d52f3a1` | Contrast fixes from accessibility scan |

## 3. Files
43 files changed (+1,348 / −33).
- **New:** `app/tokens.css`, `app/mnemba.css`, `components/site-nav.tsx`, `components/mt-ui.tsx`, `components/fixture-row.tsx`, `public/fonts/*`, `figma/code-connect/*.figma.ts` (14 files), `figma.config.json`.
- **Changed:**
  - Root files: `app/layout.tsx`.
  - Pages: `app/football/predictions/page.tsx`, `app/football/shortlists/page.tsx`.
  - Components: `components/{intelligence-workspace,match-center,competition-center,football-entity,football-identity,entity-portrait,news-media,global-search,public-nav}.tsx`.
  - Scripts: `scripts/browser-smoke.mjs`.
  - Config: `tsconfig.json`, `eslint.config.mjs`. Both changes only exclude `figma/code-connect`.
- **Untouched:** everything under `lib/`, `app/api/`, all Azure and Cloudflare configuration, the database schema and the prediction and grading logic.

## 4. Components
- **`SiteNav`:** the rail at ≥1280px, a top bar below that, and a bottom nav below 768px. The menu and timezone sheets use native `<dialog>`, so focus trapping and Escape work. Includes a skip link.
- **`mt-ui`:** `SourceTag`, `StatusTag` + `matchStatusKind`, `GradeBadge`, `StatePanel`, `Notice`, `Skeleton`, `Uncertainty`.
- **`FixtureRow` / `FixtureGroups`:** compact fixture rows, grouped by competition.
- **Neutral fallbacks:** shield (team), award (competition), silhouette with "Photo unavailable" (player), "Media unavailable" (news). No initials, no invented logos or photos.
- **Shared styles:** buttons, chips, inputs, cards and panels. They restyle existing markup through the `--mt-*` tokens, with no new UI framework.

## 5. Routes
All existing routes are preserved; the Azure build route table is unchanged. Tabs still use `/football?tab=…`. "Saved picks" maps to `/football/shortlists`, the published picks; there is no device-saved feature.

## 6. Figma → code mapping
| Figma | Code |
|---|---|
| Color / Spacing / Radius / Border / Elevation / Layout variables | `--mt-*` in `app/tokens.css` (WEB code syntax matches) |
| Desktop navigation, Tablet top bar, Mobile bottom navigation, Nav item | `components/site-nav.tsx` |
| Compact fixture row, competition group header | `components/fixture-row.tsx` |
| Data provenance tag / Match status / Prediction grade / Uncertainty | `SourceTag` / `StatusTag` / `GradeBadge` / `Uncertainty` |
| State panel / Inline banner / Loading skeleton | `StatePanel` / `Notice` / `Skeleton` |
| Team badge / Competition emblem / Player portrait | `IdentityBadge` / `CompetitionIdentity` / `EntityPortrait` |
| Match header, Prediction card (expanded), Probability bar | `components/match-center.tsx` + `.match-hero`, `.mt-prob-bar` |
| League card, News card / Featured news card | workspace tabs + `app/mnemba.css` |

## 7. Screenshots
These are stored outside the repository in `mnemba-figma-verification-20261120/`, beside the repository folder:
- **`figma/`:** Figma frame renders.
- **`p8/`:** five viewports × 12 routes, dark theme, menus and focus.
- **`p9/`:** captures taken after the fixes.
- **`r1/`:** captures from the screen work.
- **`logs/`:** final test, build, lint, accessibility and journey outputs.

## 8. Visual comparison
- **Matches:** navigation, the fixture rows and groups, the match header and prediction card, league cards, the featured news layout, state panels, tags, type and colour all match the approved frames.
- **Intentional differences:** these come from the rule against inventing data. Full details are in `COMPARISON.md` in the screenshots folder. The following frame elements were not built because the product has no such data:
  - match tabs for Form, Head-to-head, Table, Lineups and Statistics
  - standings tables
  - continent grouping
  - news category chips and the video section
  - history record tiles
  - a per-row model pick on fixtures

  Existing controls that do more than the Figma version were kept: the matchday range selector and the extra secondary routes.
- **Fixed during comparison:**
  - score alignment
  - heading tracking
  - league card title size
  - dark-mode text on navy surfaces
  - News loading, error and empty states

## 9. Accessibility
- **axe-core 4.10 (WCAG 2.1 A/AA):** 30 scans covering 11 routes at 1440 and 375, plus dark theme on 4 routes. **0 violations** after the fixes.
- **Responsive sweep (320, 375, 768, 1024, 1440):** across 12 routes there was no horizontal overflow and no interactive target under 44×44px.
- **Behaviour checks:**
  - The skip link moves focus to main.
  - The mobile menu sheet traps focus, closes on Escape, and returns focus to "More".
  - The timezone sheet closes from its button.
- **Semantics and motion:**
  - Probability bars and decorative badges carry accessible labels or `aria-hidden`.
  - Profile images sit outside the `h1`.
  - Reduced motion is honoured.

## 10. Tests
Run in a fresh LF checkout of `d52f3a1` after `npm ci`:

| Check | Result |
|---|---|
| `tsc` (app) / `tsc -p tsconfig.azure.json` | pass / pass |
| Unit / System | 47/47 / 125/125 |
| Azure | 3 pass and 3 skipped without `DATABASE_URL`. Against a throwaway local PostgreSQL 18 loaded from a copy of the local D1 data, **6/6 pass** (run at `8fb2b32`; the only later change is CSS). |
| Cloudflare (vinext) build / Azure (`next build --webpack`) build | pass / pass |
| Click-through journeys | 19/19 (rail tabs, fixtures→match→team, search→profile, news→article, leagues→competition, 7 secondary routes, skip link, mobile sheet, bottom nav) |
| Internal links / images | 279 links checked: 0 broken. 0 failed images. 0 page errors. |
| `scripts/browser-smoke.mjs` | Stops at the featured-match carousel because today (2026-11-20) has no local fixtures. The step depends on the date and the featured-match code is unchanged from the baseline. With that step guarded, the next carousel-only step stops the same way. |

## 11. Lint debt
Full repo: **85 errors, 25 warnings**. The recovered baseline is also 85 errors, so there are **zero new lint errors**. The edited files that carry errors were spot-checked file by file against the baseline, and their counts are unchanged. One baseline warning was removed.

## 12. Code Connect
- Parserless templates live in `figma/code-connect/` with `figma.config.json`. They cover:
  - Button
  - Nav item
  - Desktop navigation
  - Mobile bottom navigation
  - Search field
  - Compact fixture row
  - Team badge
  - Player portrait
  - Data provenance tag
  - Match status
  - Prediction grade
  - Uncertainty indicator
  - State panel
  - Inline banner
- **Not published:** publishing writes to Figma, and the design was read-only during implementation. Publishing also needs a Figma access token and an Organization or Enterprise plan.
- **No template for these** (no single code component exists): Prediction card, News card and Player card are composed inline in their screens.

## 13. Limitations
- Some Figma sections are not implemented because the data does not exist (see §8).
- The logo is the existing original "M" mark. The recently generated logo was **not** added; it is waiting for your approval.
- Dark theme is opt-in through `data-theme="dark"`. There is no user toggle yet.
- Several legacy pages (Markets, Coverage, Visual credits, Basketball) inherit tokens and navigation but were not redesigned screen by screen.

## 14. Local startup
```
npm ci
npm run dev        # http://localhost:5173 (local D1 data only)
```

## 15. Push / PR plan (not executed)
1. Review this report and the screenshots.
2. `git push -u origin figma/redesign`. Pushing a non-main branch does not trigger `azure-deploy.yml`, which runs on `main` only.
3. Open a PR `figma/redesign → main`. Request review, and confirm the PR checks if any are configured.
4. **Merging to `main` deploys.** Treat the merge as the release decision.

## 16. Azure deploy and rollback plan (not executed)
- **Deploy:**
  - Merging to `main` runs `azure-deploy.yml`. That builds the image and creates a new `mnemba-web` revision.
  - Traffic is `latestRevision: true`, so the new revision takes 100% at once.
  - Afterwards, verify `/api/health` returns `{"status":"ok","database":"ready"}`, then open `/football`, a match page, `/football/search` and a news article.
- **Rollback:**
  - Reactivate revision `mnemba-web--crest-size-20261005` and route traffic back to it.
  - Alternatively, redeploy image digest `sha256:d5afd28e…` (web).
  - Jobs stay on `sha256:d585b04f…`.
  - The full anchors are in `PRODUCTION_SOURCE_RECOVERY_REPORT.md` §12. Do not delete those ACR tags.
- **No data risk:** the redesign changes UI only. There are no migrations and no changes to environment variables, secrets, DNS or jobs.
