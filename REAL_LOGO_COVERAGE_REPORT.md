> 5 October 2026 logo production checkpoint: deployed; teams 2,615/3,577, competitions 144/268, original competition set 68/68, Tanzania 16/16. Local teams 792/1,286. Coverage remains incomplete. See [LOGO_COMPLETION_REPORT.md](LOGO_COMPLETION_REPORT.md) and the exact lists under `reports/`. Older local-only/no-deployment statements below are historical.

# Real-logo completion — in progress, 21 September 2026

This supersedes the previous zero-real-logo audit. The project owner explicitly confirmed permission for the intended team and competition images. The assertion is recorded in `config/logo-permission.json`; it is not represented as a Creative Commons license or permission to republish source match statistics. No separate logo pack exists or is being awaited.

Local enrichment extends the existing media tables and shared visual components. No fixture, model, prediction, basketball, live worker or Azure job changes. The local database was backed up before enrichment under `.sites-runtime/real-logos/before-enrichment-*.sqlite`. No deployment has occurred.

Run `node scripts/real-logo-enrichment.mjs` for the actual current audit. `.sites-runtime/real-logos/coverage.json` contains exact entity/provider IDs, missing records, source attempts and regional/Tanzania summaries. Counts are not reduced by hiding identities. The final gate remains unmet while any unresolved records remain.

Validated sources so far: existing TheSportsDB mappings and structured lookups; Wikipedia image references; OpenLigaDB exact team-ID logo references; pinned luukhopman/football-logos catalogue with country/name checks; country-checked APWin searches/standings and individually reviewed Global Sports Archive references. Attribution, source, owner permission reference, decoded dimensions, content type, image hash and check timestamp are stored per asset. Source images are not rehosted in production. Stored fallback visuals remain runtime error handling, never successful audit entries.

Evidence and resumable source reports are in `.sites-runtime/real-logos/`. Discovery scripts are under `scripts/discover-*-logos.mjs`; reviewed candidates are in `config/reviewed-logo-candidates.json`. Source-side HTTP 429/503 and absent/mismatched identities remain unresolved, never fabricated.

Tanzania checkpoint: all 16 stored NBC Premier League teams and its one competition have real decoded images in the local database. Actual image rendering passed in the Tanzania match page; the England, Spain, Germany, Japan and Americas match pages also passed without failed image requests. Evidence: `.sites-runtime/real-logos/browser/evidence.json`. The generic league mark is used, not an invented current NBC sponsor lockup.

The database also contains unresolved tournament participants (`3rd Group …`, `Runner-up Group …`, `Winner Group …`, `Winner Match …`). A correct real-team crest cannot be assigned to a slot before its participant is established. Preserve these records and list their exact IDs as blockers; do not manufacture a crest or quietly exclude them from the denominator.

Latest recorded checkpoint (enrichment continues): 576/1,286 team records real (44.79%), 710 missing including 32 blocked identity records; 68/68 competition records real (100%), zero missing or known broken competition images. 594 distinct assets decoded and hashed. These are local counts, not production counts.

Validation: image decoding/security and identity-discovery unit tests passed; media/visual resolver system checks passed; `pnpm build:azure` passed with a 2 GiB Node heap; typecheck passed after the build. Six real-provider regional browser checks passed at `http://localhost:5184`. Local preview uses preserved PostgreSQL volume, container `mnemba-logo-verify-pg`, schema `local_verified`; media-only sync does not change fixtures. Production has not been updated.

Remaining work: finish the resumable APWin team pass, import reviewed GSA club candidates, retry the pinned catalogue with enriched country context, sync preview media, verify remaining UI paths and update final counts. Unattempted records are unresolved, not claimed exhausted. Thirty tournament participant slots and two malformed source team strings need identity resolution before a correct crest is possible.
