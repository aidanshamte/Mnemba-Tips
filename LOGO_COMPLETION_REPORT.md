# Logo production implementation and remaining coverage — 5 October 2026

Status: deployed and production backfill verified; **coverage completion remains incomplete**. No claim that every remaining team lacks an obtainable crest. Further identity/source work is still required, and Wikimedia rate limits blocked the slower retry. Exact production snapshot: 2026-10-05T05:08:43.274000+00:00.

## Root cause and preserved work

Before writes, the production visual API returned empty team and competition catalogs despite 214 media assets and 225 links. RB Leipzig's exact OpenLigaDB identity had no media link. Frankfurt's existing legacy badge lacked the owner-permission/decoded-image metadata accepted by the existing resolver. The actual match browser showed RL/EF and made no crest image request. The failure was missing eligible production media, not a requirement to rebuild the frontend or replace canonical IDs. The four existing OpenLigaDB/OpenFootball identities were backfilled first; both real crests then rendered before the large import.

The existing dirty tree was preserved. Starting main/HEAD was e6c3dd2; status and HEAD are recorded in `.sites-runtime/logo-completion/`. No reset, clean, restore, stash, identity rewrite, fixture/model change, or database replacement was performed. Production mutations were media assets/links, URL validation/enrichment state, and the authorized application/job image updates. Previous affected media rows are retained in the applied-transfer logs before each transaction.

## Measured coverage

| Scope | Before | After | Remaining fallback |
|---|---:|---:|---:|
| Local teams, canonical audit | Saved 616/1,286; fresh pre-work 663/1,286 | 792/1,286 (61.59%) | 494 |
| Production team records | 0/3,577 publicly eligible | 2,615/3,577 (73.11%) | 962 |
| Production competition records | 0/268 publicly eligible | 144/268 (53.73%) | 124 |
| Original 68 competition records in production | Not published | 68/68 | 0 |
| Original Tanzania team set in production | Not published | 16/16 | 0 |

Production counts are persisted provider records, not the locally coalesced canonical denominator. Neither denominator excludes blocked records. Production unresolved identities: **41**, included in the 962 fallback records. They consist of 30 participant slots and 11 malformed abandoned-match fragments. The original local 32 are the same 30 slots plus the AS Muhanga match fragment and `in 30']` fragment. Historical-source fragments need an ingestion/identity correction beyond a media-only change; no crest was assigned to them.

Published broken URLs: **0 observed across 2570 distinct URLs**. The local audit separately reports 11 broken Uganda candidates (listed below) and 483 missing records, including the 32 blocked identities. Uganda's official host returned HTML with HTTP 200; these rejected candidates were not imported into production. Five initially broken local Uganda candidates were subsequently resolved through verified Wikipedia images.

Regional production team coverage uses stored country/provider evidence and fixture competition context. Unknown geography remains explicit; these figures are not claimed to cover every actual club in those regions.

| Region | Real / total | Coverage |
|---|---:|---:|
| Africa | 243/346 | 70.23% |
| Europe | 1346/1762 | 76.39% |
| Asia | 153/169 | 90.53% |
| South America | 310/339 | 91.45% |
| North America | 136/147 | 92.52% |
| Oceania | 26/29 | 89.66% |
| Unknown | 401/785 | 51.08% |

## Implementation and discovery

The existing registry, resolver, `Store.saveMedia` path and tables remain authoritative. New media-only import/export tools require exact existing IDs and names, permission evidence, fresh decoded metadata/hash and safe URLs. They never create football identities. Dry runs and prior-row backups preceded the larger production transactions.

Scheduled badge enrichment now uses the shared byte decoder, persisted validation/cache/backoff, legitimate owner-permission metadata, direct provider identities and exact provider-supplied image references. LiveScore team/competition filenames must come from that entity's source record; they are never guessed from IDs. Failed/skipped queue entries can re-enter when a new verified provider candidate arrives. Tests cover newly encountered teams/competitions, invalid image bodies, alternate candidates, permission gates and canonical lookup. Public pages make no online discovery calls.

Backfill manifest: 2,759 validated entity entries. Discovery included existing local verified assets, structured provider records, 1,655 explicit LiveScore team references, competition image references, TheSportsDB, pinned catalogues, official Uganda profiles and resumed APWin checks. Wikipedia checked all 1,001 remaining production targets; 39 candidates passed exact identity/country/source and byte validation. The initial bulk API response omitted some introductions; those were fetched in smaller batches before retrying. The slower one-worker retry stopped at a renewed HTTP 429; 194 retry candidates remain deferred, with prior reasons preserved. Some missing identities still need targeted official-source research; the pass does not establish that all available sources have been exhausted.

The exact missing/initials list and per-record reasons are in [logo-unresolved-2026-10-05.csv](reports/logo-unresolved-2026-10-05.csv). Full public identity/provenance, regional counts, rejected local assets and source attempts are in [logo-coverage-2026-10-05.json](reports/logo-coverage-2026-10-05.json). There are 962 team and 124 competition rows in the unresolved CSV. No verified visual is counted as initials solely because its lazy image is outside the viewport.

## Deployment and automatic enrichment proof

Production: https://aidanshamte.me. Active healthy Azure revision: **mnemba-web--logos-20261005**.

Image: `mnembab55deec1.azurecr.io/mnemba@sha256:d585b04f603c1b16ef1dd17666944319903d146b38f1822089cc97d813a5f311`.

The existing `mnemba-update-0`, `mnemba-update-1`, and `mnemba-update-2` jobs use this same image; their schedules remain `0 * * * *`, `20 */3 * * *`, and `40 3 * * *`. The manual import job was not changed. A media-only run of the deployed enrichment processed San Antonio, Oakland Roots, Monterey Bay FC and New Mexico United: four processed, four unchanged verified assets, zero failures. This proves the real deployed decoder/registry path; future newly ingested candidates are covered by targeted tests, not falsely claimed as a newly observed scheduled production event.

Previous web image for operational rollback: `sha256:ffb5776835728742d6e00ac12221ff897109fdd6229fd7ec7fcace8f4f6ed92c`. Previous scheduled-job image: `sha256:de2df148b4fb3e54ea4800fb275dc6afc7070187e43b261ab9f8af1b582c1411`. Restoring an image would not undo additive media imports; affected-row snapshots are separate. Do not replay old media snapshots blindly after later enrichment.

## Browser and tests

- Leipzig and Frankfurt: correct real crests, production match header, no RL/EF fallback. Screenshot: `.sites-runtime/logo-completion/browser/Leipzig-and-Frankfurt.png`.
- All 16 Tanzania team profile badges passed. Regional profile samples passed for England, Spain, Italy, France, South America, North America, Asia, national teams, women's teams and a historical StatsBomb identity.
- Every published asset in the initial catalog loaded: 2,531 distinct URLs. All 39 subsequently checked Wikipedia URLs loaded; the union is 2570 URLs.
- Fixture cards and search passed. Scrolled production tests passed for 92 match/history/H2H/standings badges, 1,001 Tanzania competition badges and 60 prediction archive badges: no verified-but-fallback badge after loading and no page errors. Initial predictions-test timing and off-screen lazy-loading observations were retested correctly rather than reported as data failures. Match prediction detail shares the verified match header. A currently live match was not available for a separate live-state crest observation; the shared badge path is used there.
- Verified starting baseline: 34/35 unit/system files; the existing `job-outcomes.test.mjs` failure predates this work. The old 120/120 report was not treated as current evidence.
- Full unit/system/Azure run: 39/41 files passed inside the sandbox. `live-isolation.test.mjs` failed only because its subprocess was sandbox-constrained; the targeted outside-sandbox run passed both tests. Effective result: **40/41 files**, with only the existing job-outcomes `empty` versus `degraded` mismatch unresolved. No new test failure remains.
- Targeted new/changed logo/provider test files passed. Azure build, TypeScript check, targeted lint and `git diff --check` passed. The native Sharp decoder was tested in the release container. Final offline discovery/reporting additions do not change the deployed runtime bundle.

## Exact unresolved production identities

- `openfootball:3rd%20Group%20A%2FB%2FC` — 3rd Group A/B/C
- `openfootball:3rd%20Group%20A%2FB%2FC%2FD` — 3rd Group A/B/C/D
- `openfootball:3rd%20Group%20A%2FD%2FE%2FF` — 3rd Group A/D/E/F
- `openfootball:3rd%20Group%20D%2FE%2FF` — 3rd Group D/E/F
- `openfootball:APR%20FC%20%20%20%20%20%20%20%20%20%20%20%20%20abd.%20%20%20Gasogi%20United%20%20%20%20%20%20%20%5Babandoned%20at` — APR FC             abd.   Gasogi United       [abandoned at
- `openfootball:Arua%20Hill%20SC%20%20%20%20%20%20%20%20abd.%20%20%20Gaddafi%20Modern%20FC%20%20%20%5Babandoned%20at` — Arua Hill SC        abd.   Gaddafi Modern FC   [abandoned at
- `openfootball:AS%20Muhanga%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20abd.%20%20%20Police%20FC%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%5Babandoned%20at` — AS Muhanga               abd.   Police FC                 [abandoned at
- `openfootball:Bugesera%20FC%20%20%20%20%20%20%20%20abd.%20%20%20Rayon%20Sports%20%20%20%20%20%20%20%20%5Babandoned%20at` — Bugesera FC        abd.   Rayon Sports        [abandoned at
- `openfootball:in%2030'%5D` — in 30']
- `openfootball:in%2057'%20due%20to%20crowd%20trouble%5D` — in 57' due to crowd trouble]
- `openfootball:in%2060'%20due%20to%20heavy%20rain%5D` — in 60' due to heavy rain]
- `openfootball:in%207'%20due%20to%20rain%5D` — in 7' due to rain]
- `openfootball:Mukura%20VS%20%20%20%20%20%20%20%20%20%20abd.%20%20%20Gorilla%20FC%20%20%20%20%20%20%20%20%20%20%5Babandoned%20at` — Mukura VS          abd.   Gorilla FC          [abandoned at
- `openfootball:Runner-up%20Group%20A` — Runner-up Group A
- `openfootball:Runner-up%20Group%20B` — Runner-up Group B
- `openfootball:Runner-up%20Group%20C` — Runner-up Group C
- `openfootball:Runner-up%20Group%20D` — Runner-up Group D
- `openfootball:Runner-up%20Group%20E` — Runner-up Group E
- `openfootball:Runner-up%20Group%20F` — Runner-up Group F
- `openfootball:Sunrise%20FC%20%20%20%20%20%20%20%20%20%20%20abd.%20%20%20Kiyovu%20Sports%20%20%20%20%20%20%20%20%20%5Babandoned%20at` — Sunrise FC           abd.   Kiyovu Sports         [abandoned at
- `openfootball:Vision%20FC%20%20%20%20%20%20%20%20%20%20abd.%20%20%20Police%20FC%20%20%20%20%20%20%20%20%20%20%20%5Babandoned%20at` — Vision FC          abd.   Police FC           [abandoned at
- `openfootball:Winner%20Group%20A` — Winner Group A
- `openfootball:Winner%20Group%20B` — Winner Group B
- `openfootball:Winner%20Group%20C` — Winner Group C
- `openfootball:Winner%20Group%20D` — Winner Group D
- `openfootball:Winner%20Group%20E` — Winner Group E
- `openfootball:Winner%20Group%20F` — Winner Group F
- `openfootball:Winner%20Match%2037` — Winner Match 37
- `openfootball:Winner%20Match%2038` — Winner Match 38
- `openfootball:Winner%20Match%2039` — Winner Match 39
- `openfootball:Winner%20Match%2040` — Winner Match 40
- `openfootball:Winner%20Match%2041` — Winner Match 41
- `openfootball:Winner%20Match%2042` — Winner Match 42
- `openfootball:Winner%20Match%2043` — Winner Match 43
- `openfootball:Winner%20Match%2044` — Winner Match 44
- `openfootball:Winner%20Match%2045` — Winner Match 45
- `openfootball:Winner%20Match%2046` — Winner Match 46
- `openfootball:Winner%20Match%2047` — Winner Match 47
- `openfootball:Winner%20Match%2048` — Winner Match 48
- `openfootball:Winner%20Match%2049` — Winner Match 49
- `openfootball:Winner%20Match%2050` — Winner Match 50

## Exact locally rejected Uganda images

All returned non-image responses during fresh decoding and remain excluded unless a different validated source resolves the identity. Exact candidate URL/check details remain in `.sites-runtime/logo-completion/local-new-media.json`, validation logs and the local media URL-check table.

- `openfootball:BUL%20FC` — BUL FC
- `openfootball:Buhimba%20United%20Saints` — Buhimba United Saints
- `openfootball:Calvary%20FC` — Calvary FC
- `openfootball:Entebbe%20UPPC%20FC` — Entebbe UPPC FC
- `openfootball:Express%20FC` — Express FC
- `openfootball:KCCA%20FC` — KCCA FC
- `openfootball:Lugazi%20FC` — Lugazi FC
- `openfootball:NEC%20FC` — NEC FC
- `openfootball:Police%20FC` — Police FC
- `openfootball:SC%20Villa` — SC Villa
- `openfootball:Vipers%20SC` — Vipers SC

## Safest remaining work

Resume the recorded rate-limited discovery queue after provider backoff; then continue bounded official-source checks for unresolved, identifiable teams and the additional production competitions. Keep exact-ID/country/category matching and image validation. Treat malformed participant records as a separate targeted ingestion correction, never attach a guessed logo. Re-run media-only import and affected browser checks after each successful batch. Full coverage has not yet been achieved.
