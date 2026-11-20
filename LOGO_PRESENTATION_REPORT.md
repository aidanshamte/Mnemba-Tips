# Responsive logo presentation — 5 October 2026

Frontend-only enhancement of the existing shared identity component. No discovery, provider, canonical identity, media, fixture, prediction, or scheduled-job changes.

The old header explicitly requested 44px badges. Shared variants now provide tiny 22px, small 32px (default), medium 48px, large 72px, and hero 112px. Hero becomes 96px at tablet widths and 76px on mobile. Existing numeric `size` callers remain supported. The main match uses hero crests and a 48px competition identity (44px mobile); team profiles use hero and competition headings use large. Compact lists keep their existing sizes.

Both teams stay in balanced columns around the score at 320px and above. Legacy away-team badge margins and inherited oversized heading typography have scoped overrides. Images use `object-fit: contain`, rectangular unclipped artwork bounds, and eager loading in hero contexts. Initials retain identical box dimensions on image failure.

Frankfurt uses its existing verified 512×512 PNG. Leipzig uses the existing immutable verified 139×181 PNG: measured nontransparent artwork is 139×90 at (0,45). No higher-resolution verified alternative was linked to these exact identities. A presentation scale of 181/139, keyed to the verified content hash, compensates for transparent padding while preserving every artwork pixel and the original aspect ratio. No source image was replaced, resampled, or assigned to another identity. Leipzig remains limited to its existing intrinsic resolution; this change does not invent a higher-resolution asset.

Verification artifacts are under `.sites-runtime/logo-sizing/`. `scripts/browser-logo-sizing.mjs` checks real source URLs, natural/rendered dimensions, containment, four viewport widths, no overflow, aligned badge boxes, compact prediction badges, three crest shapes, and stable fallbacks after a deliberately blocked image request. Local preview proxies read-only production API responses, excluding the long-lived event stream; production checks use the actual production page.

## Production verification

Deployed healthy revision: `mnemba-web--crest-size-20261005`.

Image: `mnembab55deec1.azurecr.io/mnemba@sha256:d5afd28eab8fe106c03b071fe34b4dafba08bd7e6b415816bdf2bff7981e2b0c`.

The actual production Leipzig/Frankfurt match passed at 1440px (112px crests), 900px (96px), 390px and 320px (76px). Competition branding measured 48px desktop/tablet and 44px mobile. Both sources loaded with original natural dimensions, `object-fit: contain`, aligned containers, no page errors and no horizontal overflow. Compact prediction badges measured 32px. Profile samples for Juventus, Arsenal and Boca Juniors de Cali passed; blocked-image simulation preserved 76×76 fallback dimensions. Desktop/mobile production screenshots were visually inspected.

All 2619 team catalog keys and 144 competition catalog keys retained exactly the same source URLs. Catalog keys include canonical aliases, so this is not a revised entity coverage count. Zero mapping changes were observed. No production database writes or enrichment/backfill runs were performed for this task. Scheduled-job images were not changed.

Azure production build (including TypeScript) passed; existing visual system tests passed. Targeted lint of the shared badge components and browser verification script found no errors and one native-image advisory. Broader touched-page lint still reports existing `any`/render-time purity findings in unchanged code; no unrelated cleanup was made. `git diff --check` passed.

Evidence: `.sites-runtime/logo-sizing/production.json`, `production-1440.png`, `production-390.png`, `mapping-verification.json`, `revision-health.json`, `build-final.log`, and `visual-tests.log`. The production browser tests ran against the deployed application without injected CSS or API interception. The separate image-failure case deliberately blocked only Frankfurt's image request in that test browser.

Previous image for web rollback: `mnembab55deec1.azurecr.io/mnemba@sha256:d585b04f603c1b16ef1dd17666944319903d146b38f1822089cc97d813a5f311`.

