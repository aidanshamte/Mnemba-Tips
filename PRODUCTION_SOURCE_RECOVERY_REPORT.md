# Production source recovery report — Mnemba Tips

Audit date: 2026-11-20 (UTC). Read-only recovery. Nothing in Azure, ACR, GitHub, DNS or the production database was changed.

## Summary

The October 5 production source **can be reconstructed with high confidence**. GitHub now has an exported Codespaces branch, `origin/codespace-congenial-journey-6q9w6rpxqqpf5j54` at `76d1fce`. Every readable source file in the production image is **byte-identical** to that branch: 104 files across `lib/`, `config/`, `scripts/azure/`, `public/` and `package.json`.

The frontend (`app/`, `components/`) ships only as compiled output. Its codespace source matches production on every route and on the crest-sizing CSS. Differential string checks also favour the codespace version strongly over `origin/main`. However, it is not byte-provable without a rebuild.

## 1. Production image and digest

| Item | Value |
|---|---|
| Subscription | Azure for Students, `b55deec1-aecc-443f-8d1c-3401a8a6d190` |
| Resource group | `mnemba-azure` (westus) |
| Container App | `mnemba-web`, one container `web`, 0.5 vCPU / 1 GiB |
| Active revision | `mnemba-web--crest-size-20261005` (created 2026-10-05T05:37:28Z) |
| Traffic | `latestRevision: true`, weight 100. **Any new revision takes 100% of traffic immediately.** |
| Image reference | `mnembab55deec1.azurecr.io/mnemba@sha256:d5afd28eab8fe106c03b071fe34b4dafba08bd7e6b415816bdf2bff7981e2b0c` |
| Tag | `logo-sizing-20261005` (index pushed 2026-10-05T05:36:57Z) |
| Index type | OCI image index → linux/amd64 manifest `sha256:cece3242f8605a61ce80d052debb62a19ee6b6aef42f4c97232a217d5491ea48` + buildkit attestation `sha256:cca43e61…` |
| Config | `sha256:6fbd1275287dd3f5ae75c9cdcb9d8c5028b234adafbedfc44380cc0e12f58696`, created 2026-10-05T05:36:04Z |
| Cmd / user / workdir | `node scripts/azure/start.mjs` / `node` / `/app` |
| Env var **names** in the app | `DATABASE_URL MNEMBA_DATABASE_SCHEMA MNEMBA_SCHEMA_MANAGED MNEMBA_RUNTIME_MODE MNEMBA_ENABLE_UPDATES MNEMBA_INTERNAL_TOKEN MNEMBA_LIVESCORE_ENABLED` (values not read) |

## 2. Scheduled-job images and digests

| Job | Cron (UTC) | Command | Image |
|---|---|---|---|
| `mnemba-update-0` | `0 * * * *` | `node scripts/azure/job.mjs` | `…/mnemba@sha256:d585b04f603c1b16ef1dd17666944319903d146b38f1822089cc97d813a5f311` |
| `mnemba-update-1` | `20 */3 * * *` | same | same |
| `mnemba-update-2` | `40 3 * * *` | same | same |
| `mnemba-import` | Manual | (default) | `…/mnemba:migration-20260917` (unchanged since migration) |

`d585b04f…` is tag `logos-20261005`, pushed 2026-10-05T04:44:11Z. Its amd64 manifest is `sha256:4880eadcf83140e7220789432a6218c661af9da3cedbc4080943c73da9941a72` and its config is `sha256:a17e9dba…`, created 04:42:02Z.

**Job vs web difference:** the readable source is identical in both images (the same snapshot hash). The web image adds exactly one layer, `sha256:8ca1ee75…` (~1 MB). That layer contains only a recompiled `.next-azure/` and `server.js` for the crest/badge sizing CSS. The jobs run server-side code only, so their behaviour matches the web image's server code.

### Image build history (from image config)

These images were **not** built fresh from `Dockerfile.azure`. Each release stacked layers on the previous image:

- L00–L11: original `Dockerfile.azure` build (node:24-bookworm-slim, standalone, public, lib, config, scripts/azure).
- L12–L21: five rounds of `rm -rf /app` followed by `COPY . /app`, each based on the prior image. The embedded `/app/Dockerfile` reads `FROM …@sha256:c97a3942…` (`ingestion-20260924`).
- L22: `created_by: node scripts/azure/start.mjs`. This is a **container snapshot** (`docker commit`-style) that changed `intelligence.mjs`, `live.mjs`, `livescore.mjs`, `service.mjs` and `scripts/azure/start.mjs`. The final versions of those files are byte-identical to the codespace branch.
- L24: `COPY app/ /app/` (logos release). Updated the logo/media/livescore `lib` files, `config/logo-permission.json`, the `sharp` runtime and the compiled frontend.
- L25 (web only): `COPY app/ /app/` (crest sizing). Compiled frontend and `server.js` only.

### ACR tags, Sep 17 – Oct 5 (non-secret; full TSV in the recovery directory)

```
2026-09-17T09:13Z migration-20260917            sha256:5fec90f3…
2026-09-17T09:27Z a673e733… (commit-tagged)      sha256:5858ad90…
2026-09-17T09:38Z e2863a55… (commit-tagged)      sha256:72eafed0…
2026-09-17T10:46Z ebe68ea4… (commit-tagged)      sha256:aa6139eb…   ← last GitHub-built image
2026-09-17T12:02Z useful-20260917-1202          sha256:90e9f7ee…
2026-09-17T12:07Z useful-20260917-1207          sha256:aad2471a…
2026-09-17T16:02Z global-20260917-1603          sha256:9ff7c293…
2026-09-17T16:08Z global-20260917-1607          sha256:842f4fb1…
2026-09-18T01:17Z worldwide-20260918-verified   sha256:c0376b12…
2026-09-21T01:57Z worldwide-20260921            sha256:2b8fb2cd…
2026-09-21T02:21Z worldwide-20260921-final      sha256:315b2e60…
2026-09-21T03:07Z live-20260921                 sha256:d3857fb8…
2026-09-24T14:47Z recovery-20260924             sha256:9b042a42…
2026-09-24T15:30Z ingestion-20260924            sha256:c97a3942…
2026-09-24T15:51Z livescore-20260924            sha256:de2df148…
2026-09-26T02:25Z availability-20260926         sha256:ffb57768…
2026-10-05T04:44Z logos-20261005                sha256:d585b04f…   ← jobs
2026-10-05T05:36Z logo-sizing-20261005          sha256:d5afd28e…   ← web, 100% traffic
```

## 3. Source files successfully recovered

**Acquisition method.** Docker is not installed here. Instead, manifests and layer blobs were downloaded read-only from the ACR registry API, using a short-lived pull token that was never printed or saved. Every manifest and blob was re-hashed and matched its sha256 digest (31 objects, 0 mismatches). The layers were applied in order with OCI whiteout handling, `/app` only. No container was created or run.

**Recovered readable files (web image = jobs image):** 104 files.

- `lib/`: 66 files (`lib/football/*.mjs` including schema-v2…v9, `lib/azure/{bindings,postgres}.mjs`, `lib/prediction-engine.mjs`, `lib/demo-data.mjs`, `lib/utils.ts`)
- `config/`: 4 (`football-sources.json`, `live-sources.json`, `logo-permission.json`, `reviewed-logo-candidates.json`)
- `scripts/azure/`: 22 (including `start.mjs`, `job.mjs`, `live-worker.mjs`, `worldwide.mjs`, `import-logos.mjs`, `migrate.mjs`)
- `public/`: 9
- `package.json`, plus the generated `Dockerfile` (overlay) and `server.js` (Next standalone)

**Comparison against git (by git blob hash):**

| Recovered file vs → | `origin/main` | codespace branch |
|---|---|---|
| Identical | 54 | **102** |
| Modified | 21 | 0 |
| Absent from ref | 29 | 2 (`Dockerfile` overlay, `server.js`: both generated) |

Readable files in `origin/main` that are missing from the image: 0. Readable files in the codespace branch that are missing from the image: 1, `scripts/azure/livescore-production-verify.mjs` (a verification script, not a runtime file).

### Changes since `origin/main`, by theme (all byte-identical to production)

- **Worldwide coverage:** `global-competitions.mjs`, `worldwide-targets.mjs`, `priority-coverage.mjs` (+42/−8), `competition-catalog.mjs`, `source-registry.mjs`, `scripts/azure/{worldwide,global-coverage,global-browser}.mjs`
- **Live-data ingestion:** `live.mjs`, `live-stream.mjs`, `livescore.mjs`, `openligadb.mjs`, `fixture-ingestion.mjs`, `config/live-sources.json`, `app/api/football/live/route.ts`, `scripts/azure/live-worker.mjs`, `scripts/azure/start.mjs` (starts the web server plus the live worker), `adapters.mjs`, `scheduled.mjs`
- **Availability:** `scripts/azure/{recovery-verify,recovery-browser,backup-data,audit}.mjs`, `http.mjs`, `access.mjs`, `mirrors.mjs`. Per `AVAILABILITY_RECOVERY_REPORT.md`, production was restored on 2026-09-26 at revision `recovery-live`.
- **Logos and crests:** `logo-discovery.mjs`, `logo-permission.mjs`, `image-validation.mjs` (uses `sharp`), `media-backfill.mjs`, `media-registry.mjs` (+56/−10), `media-policy.mjs`, `public-enrichment.mjs`, `visuals.mjs`, `config/{logo-permission,reviewed-logo-candidates}.json`, `scripts/azure/import-logos.mjs`. **Crest sizing** (`LOGO_PRESENTATION_REPORT.md`) is a frontend-only change in `app/intelligence.css` and `components/football-identity.tsx`.
- **Prediction and grading:** `intelligence.mjs` (+33/−7), `estimates.mjs` (+14/−5), `model-lab.mjs`, `recommendations.mjs`, `service.mjs` (+27/−16), plus `scripts/evaluation/binary.mjs` (tooling, not in image)
- **Database schema:** **no new migrations.** `schema-v9.mjs` is still the latest, and `schema*.mjs` is unchanged between `origin/main`, the codespace branch and production. No DDL was added in the changed `lib/` files. `store.mjs` changed by +3/−1 (non-DDL).
- **Deployment:** `Dockerfile.azure` CMD changed from `server.js` to `scripts/azure/start.mjs`, matching the image Cmd. `next.config.ts` adds CSP image hosts, and the result matches the live `content-security-policy` header captured on 2026-11-20 exactly. `package.json` adds the `sharp` 0.34.5 devDependency and the `media:audit:logos` script, and is byte-identical to the image. `.github/workflows/azure-deploy.yml`, `infra/` and `lib/azure/` are unchanged.

## 4. Files that differ from origin/main

The codespace branch differs from `origin/main` in 154 paths (105 added, 49 modified); the full list is in section 10. Of the files shipped in the image, 48 differ from `origin/main` (27 added, 21 modified), and all 48 are byte-identical in the codespace branch.

## 5. Files that cannot be recovered cleanly

- **Frontend source (`app/**`, `components/**`, `hooks/**`):** production has only compiled Next.js output (377 files in `.next-azure/`, minified, **no source maps**). Nothing was decompiled. The codespace source is the best available, with this evidence:
  - The route set is identical: 27/27 pages and API routes, including `/football/coverage`, `/football/visual-credits`, `/football/markets`, `/football/players`, `/football/shortlists` and `/api/football/live`.
  - All crest-sizing CSS rules found only in the web build (badge 22/32/48/72/112 px, 96/76 px breakpoints, match-score grid) are present verbatim in the codespace `app/intelligence.css`.
  - Differential markers: 145/169 literals and CSS declarations unique to the codespace version appear in the production web build, against 109/169 in the older jobs build. Every remaining miss is a compile-time artefact (TypeScript types, JSX attribute syntax, a `cloudflare:workers` import), not user-facing content.
- **Build reproducibility:** the production image was assembled by layering, so a clean `Dockerfile.azure` build from the codespace tree has never been run and verified. Byte-identical compiled output is not expected anyway, because Next build IDs and chunk hashes vary.
- **`node_modules` in the image:** the runtime dependency set (including `sharp` native binaries) is not source and was not compared.

## 6. Secret-scan result

The scan covered both extracted images (excluding `node_modules`) and every file added or modified on the codespace branch relative to `origin/main`. It checked for private keys, Postgres URLs with passwords, Azure storage keys and connection strings, SAS signatures, GitHub, AWS, OpenAI and Anthropic tokens, JWTs, cookie headers, hard-coded secret assignments, email addresses, `.env` files, database files, dumps, backups, logs, key and certificate files, and deployment parameter files.

| Path | Category | Handling |
|---|---|---|
| `.next-azure/trace`, `.next-azure/trace-build` (both images) | Generated build trace | Keep out of git (build output) |
| `.sites-runtime/dependencies/node_modules/pg*` (image) | Vendored dependency copy | Keep out of git |
| `.next-azure` symlink on codespace branch → `/tmp/mnemba-ingestion-build/next` | Build artefact committed by the export | **Exclude** from any recovery commit |

- **Secrets found:** none in either image's readable files or in the codespace changes.
- **`.env`, database, dump and backup files:** none in either image.
- **User data:** none found.
- **Environment variable values:** never read. Production secrets live only in Azure Container Apps configuration, which this audit did not touch.

## 7. Exported Codespaces branch

**Found:** `origin/codespace-congenial-journey-6q9w6rpxqqpf5j54` at `76d1fced7a7c7a28c9a19cf1529f0a0894bbbf16`, "Pending changes exported from your codespace". It was authored 2026-11-20T03:42:02Z as a single commit on top of `e6c3dd2`. It was inspected, not merged, checked out or modified.

## 8. Can production parity be reconstructed?

**Server, jobs, config and public assets: yes, exactly.** These are byte-verified against both production digests.

**Frontend: yes, with high but not cryptographic confidence**, using the codespace source.

**Deployability: not yet verified.** `package.json` declares `sharp` but the root of `package-lock.json` does not, so `npm ci` in `azure-deploy.yml` is likely to fail. This is unverified because `npm ci` was not run in this phase.

## 9. Recommended reconciliation order

1. On local branch `recovery/oct5-production-source` (currently `e6c3dd2`), apply the codespace tree **excluding** the `.next-azure` symlink, for example with `git checkout <codespace> -- <paths>`. Commit locally, without pushing.
2. Re-run the byte comparison: all 102 shipped files must still match the recovery snapshot hashes.
3. Fix the lockfile: regenerate `package-lock.json` so that `sharp` is declared, then confirm `npm ci` passes locally.
4. Run the test suites (`tests/unit`, `tests/system`, `tests/azure`) and `tsc -p tsconfig.azure.json` locally.
5. Run `npm run build:azure` locally. Compare the route list and the CSS rule set with the recovered production `.next-azure/`. Expect the same routes and a superset of the CSS rules, not identical hashes.
6. Only then push the recovery branch (not `main`) and open a PR for review. **Merging to `main` triggers `azure-deploy.yml`.** It would create a new revision that immediately takes 100% of traffic and would re-image all three update jobs. Do not merge until the user explicitly approves a deployment and a rollback plan is ready (section 12).
7. Start the Figma redesign on a branch cut from the reviewed recovery commit.

## 10. Exact files proposed for a later recovery commit

The source is `origin/codespace-congenial-journey-6q9w6rpxqqpf5j54`, compared with `origin/main` (`e6c3dd2`). A = added, M = modified.

**Byte-identical to the production image: 48 files**

```
A config/live-sources.json
A config/logo-permission.json
A config/reviewed-logo-candidates.json
M lib/football/access.mjs
M lib/football/adapters.mjs
M lib/football/competition-catalog.mjs
M lib/football/consumer.mjs
M lib/football/estimates.mjs
A lib/football/fixture-ingestion.mjs
A lib/football/global-competitions.mjs
M lib/football/http.mjs
A lib/football/image-validation.mjs
M lib/football/intelligence.mjs
A lib/football/live-stream.mjs
A lib/football/live.mjs
A lib/football/livescore.mjs
A lib/football/logo-discovery.mjs
A lib/football/logo-permission.mjs
A lib/football/media-backfill.mjs
M lib/football/media-policy.mjs
M lib/football/media-registry.mjs
M lib/football/mirrors.mjs
M lib/football/model-lab.mjs
A lib/football/openligadb.mjs
M lib/football/priority-coverage.mjs
M lib/football/public-enrichment.mjs
M lib/football/recommendations.mjs
M lib/football/scheduled.mjs
M lib/football/search.mjs
M lib/football/service.mjs
M lib/football/source-registry.mjs
M lib/football/store.mjs
A lib/football/visuals.mjs
A lib/football/worldwide-targets.mjs
M package.json
A scripts/azure/audit.mjs
A scripts/azure/backup-data.mjs
M scripts/azure/browser.mjs
A scripts/azure/global-browser.mjs
A scripts/azure/global-coverage.mjs
A scripts/azure/import-logos.mjs
A scripts/azure/live-browser.mjs
A scripts/azure/live-worker.mjs
A scripts/azure/recovery-browser.mjs
A scripts/azure/recovery-verify.mjs
A scripts/azure/start.mjs
A scripts/azure/usefulness-browser.mjs
A scripts/azure/worldwide.mjs
```

**Frontend source (matches compiled production by route + differential-marker evidence; not byte-provable): 22 files**

```
A app/api/football/live/route.ts
A app/football/coverage/page.tsx
M app/football/predictions/page.tsx
M app/football/shortlists/page.tsx
A app/football/visual-credits/page.tsx
M app/intelligence.css
M components/competition-center.tsx
M components/competition-picker.tsx
A components/coverage.tsx
M components/entity-explorer.tsx
M components/entity-portrait.tsx
M components/featured-matches.tsx
M components/football-entity.tsx
A components/football-identity.tsx
M components/football-workspace.tsx
M components/global-search.tsx
M components/intelligence-workspace.tsx
M components/match-center.tsx
M components/news-briefing.tsx
M components/public-nav.tsx
M components/team-badge.tsx
A components/use-live-match.ts
```

**Build/deploy config (consistent with production; not byte-provable): 4 files**

```
M Dockerfile.azure
M eslint.config.mjs
M next.config.ts
M pnpm-lock.yaml
```

**Tests and fixtures (not shipped in image): 24 files**

```
A tests/azure/fixture-ingestion.test.mjs
A tests/azure/live-isolation.test.mjs
A tests/azure/livescore.test.mjs
A tests/fixtures/livescore/discovery.json
A tests/fixtures/livescore/incidents.json
A tests/fixtures/livescore/lineups.json
A tests/fixtures/livescore/scoreboard.json
M tests/system/cloudflare-deployment.test.mjs
M tests/system/consumer.test.mjs
A tests/system/fixture-breadth.test.mjs
A tests/system/global-coverage.test.mjs
A tests/system/ingestion-health.test.mjs
A tests/system/live.test.mjs
A tests/system/livescore-production.test.mjs
A tests/system/logo-enrichment.test.mjs
M tests/system/media.test.mjs
M tests/system/release.test.mjs
A tests/system/saved-preview.test.mjs
A tests/system/visuals.test.mjs
A tests/system/worldwide.test.mjs
A tests/unit/binary-evaluation.test.mjs
A tests/unit/image-validation.test.mjs
A tests/unit/logo-discovery.test.mjs
A tests/unit/media-backfill.test.mjs
```

**Documentation and checkpoint reports (not shipped in image): 19 files**

```
A AVAILABILITY_RECOVERY_REPORT.md
A GLOBAL_COVERAGE_REPORT.md
A LIFECYCLE_REPORT.md
A LIVE_PIPELINE_REPORT.md
A LOCAL_DEVELOPMENT_REPORT.md
A LOGO_COMPLETION_REPORT.md
A LOGO_PRESENTATION_REPORT.md
M MASTER_PROGRESS.md
A MEDIA_REPORT.md
A PRODUCT_USEFULNESS_REPORT.md
A PUBLIC_EXPERIENCE_REPORT.md
M README.md
A REAL_LOGO_COVERAGE_REPORT.md
A REGRESSION_RECOVERY_REPORT.md
A RELEASE_REPORT.md
A SOURCE_INGESTION_RECOVERY_REPORT.md
A SOURCE_REVIEW_2026-09-18.md
A VISUAL_IDENTITIES_REPORT.md
A WORLDWIDE_RELEASE_REPORT.md
```

**Generated audit data (optional): 2 files**

```
A reports/logo-coverage-2026-10-05.json
A reports/logo-unresolved-2026-10-05.csv
```

**Local tooling scripts (not shipped in image): 34 files**

```
A scripts/azure/livescore-production-verify.mjs
M scripts/backtest-local.mjs
A scripts/browser-identities.mjs
A scripts/browser-logo-pages.mjs
A scripts/browser-logo-sizing.mjs
M scripts/browser-media.mjs
A scripts/browser-production-logos.mjs
A scripts/browser-real-logos.mjs
A scripts/browser-verified-logo-assets.mjs
A scripts/discover-apwin-logos.mjs
A scripts/discover-catalogue-logos.mjs
A scripts/discover-league-logos.mjs
A scripts/discover-official-uganda-logos.mjs
A scripts/discover-openliga-logos.mjs
A scripts/discover-real-logos.mjs
A scripts/discover-tanzania-wiki-logos.mjs
A scripts/discover-team-logos.mjs
A scripts/discover-wikipedia-logos.mjs
A scripts/evaluation/binary.mjs
A scripts/export-verified-logos.mjs
A scripts/extract-gsa-logo-references.py
A scripts/global-coverage-local.mjs
A scripts/import-reviewed-logos.mjs
A scripts/import-stored-provider-logos.mjs
A scripts/link-verified-logo-identities.mjs
A scripts/prepare-gsa-team-logos.py
A scripts/prepare-reviewed-competition-logos.mjs
A scripts/real-logo-enrichment.mjs
A scripts/record-browser-logo-failures.mjs
A scripts/sync-local-logo-preview.mjs
A scripts/validate-provider-logo-manifest.mjs
A scripts/visual-audit.mjs
A scripts/worldwide-local.mjs
A scripts/worldwide-report.mjs
```

**EXCLUDE: symlink to /tmp/mnemba-ingestion-build/next (build artefact): 1 files**

```
A .next-azure
```

## 11. Remaining blockers

- **Lockfile:** `sharp` is missing from the root of `package-lock.json`, so `npm ci` will probably fail in CI. Fix it before any merge.
- **Frontend:** the source cannot be byte-proven against production (no source maps). The evidence is strong; a local rebuild comparison (step 5) is the remaining check.
- **Clean builds:** none has been verified. Production images were built by layering, so a fresh `Dockerfile.azure` build of the recovered tree needs a local test.
- **Traffic mode:** auto-shifts to the newest revision (`latestRevision: true`), so any accidental deploy goes live at once.
- **`mnemba-import` job:** still references `migration-20260917`. Leave it alone; it is a manual job and was not run.
- **Docker:** not installed on this machine. Recovery used the registry API instead; local image builds (step 5) need Docker or an alternative.

## 12. Rollback and production-safety status

- **No changes were made** to Container Apps, jobs, revisions, traffic, images or tags, environment variables, secrets, databases, DNS, certificates, GitHub Actions or `main`. The only registry calls were pulls by digest.
- **Production after recovery** (2026-11-20): revision `mnemba-web--crest-size-20261005` at 100% on digest `d5afd28e…`, and `/api/health` returns `{"status":"ok","database":"ready"}`.
- **Rollback anchors** for any future deploy: web `…/mnemba@sha256:d5afd28eab8fe106c03b071fe34b4dafba08bd7e6b415816bdf2bff7981e2b0c` (revision `mnemba-web--crest-size-20261005`, which can be reactivated); jobs `…/mnemba@sha256:d585b04f603c1b16ef1dd17666944319903d146b38f1822089cc97d813a5f311`. Do not delete these ACR tags or digests.
- **Local git:** `main` is unchanged at `a661d46` and the working tree was clean. `recovery/oct5-production-source` was created at `origin/main` (`e6c3dd2`) with no upstream and was not checked out or pushed. This report is the only new, untracked file.

## Recovery artefacts (outside the repository)

External evidence directory `mnemba-production-recovery-20261120T034505Z/`, kept on the operator's machine outside the repository (the local path is not recorded here).

| Path | Content |
|---|---|
| `registry/manifests/`, `registry/blobs/` | Original image indexes, manifests, configs and layers (digest-verified) |
| `registry-objects.sha256` | sha256 of all 31 registry objects |
| `web-app/`, `jobs-app/` | Reconstructed `/app` filesystems (read-only reference; do not run) |
| `*.readable-source.sha256` | Per-file hashes. Snapshot hash (identical for both images): `16c806cecad6bbade6e11ac221d51b453c2e189209597b5b69b00711663e1e43` |
| `*.compiled.sha256` | Compiled-output hashes. Web snapshot `2e3222fa…79a3` (377 files); jobs `e842790d…0e47` (369 files) |
| `comparison.json`, `frontend-diffparity-*.json`, `frontend-parity-*.json` | Comparison results |
| `acr-tag-timeline.tsv`, `web-revisions.tsv` | Non-secret registry and revision metadata |
| `INVALID-whiteout-bug/` | First extraction attempt, which mishandled `rm -rf /app` whiteouts. Superseded; safe to delete. |

### Important file checksums (sha256, production image = codespace branch)

```
f95ea6fc55acfa44f0c1c36ca1aaf0069aa6d352a860b46d143b356e37b16775  package.json
a27d772b8d9d9e07e763c955bed6a9399a7d1d7d96e63f7f0764f96a0be00b42  config/live-sources.json
85131a99288e082529f25e88e33cdc128cdf941b90a09e000578c8fb2791b37e  config/logo-permission.json
871d3a21ce0f7fe2b474d968ef05149f11a9652ceb6e523ee29c1592c996b298  lib/azure/postgres.mjs
5b68bc0b5bb2ba9d4784db3a066d6636ee9e7be8a322a43ffa0452eee04127ff  lib/football/fixture-ingestion.mjs
a7cfefc619869f175c28536295c975140e8f8072e4e87d8d8f2e47b8b5ce193e  lib/football/global-competitions.mjs
2d5f61b213fd1c828b41f6db4abcf62cba43d2e7370ca686abe72599e6442fbb  lib/football/image-validation.mjs
c786cb92473d5a7ac0b0511383f91b9c26f8f95151cbe8ecd16ff3282896a193  lib/football/live-stream.mjs
8340a43f2290bf45d85e9ebdd2877216989e1c65527e81a1cccd14b075008884  lib/football/live.mjs
aeeb2b655c1c7ddc42735d7423095546d27856b7dcb261c190d4c74292109c02  lib/football/livescore.mjs
7707ba65168ff081d983dbfe9b093454b03ae9e0d2b41d144a81f55b984140f6  lib/football/logo-discovery.mjs
d7964fa9b22f574ecf76b3bf215daa5aafc4ca55feee56f4c961dca115477ee4  lib/football/media-backfill.mjs
8a47b6673d6270efd6e552a2f059a98625cf6a01ef3fa0ea5bd6e82902724849  lib/football/model.mjs
e2678c3dfaf466509194319a83fd581f715c33a8fdc3b9edc335a51ba4198019  lib/football/scheduled.mjs
dcb0c3f93194ad071d6f4f2a54482d35c5cdf4909a458a90817624302ef2ec79  lib/football/schema-v9.mjs
2c351c45d852273a69b7d14629069af603739f0c5cfe0a37ae640afd2a8d66c2  lib/football/service.mjs
256668102da94655bcd863050fb54d45d582da7cb5d6ff7261d2f42c1aadc850  lib/football/store.mjs
d1b58d7a59b43937f4f1653447b3145fb55fa7eec0128f8a61cad3f74e28d26c  lib/football/visuals.mjs
73f579c5224cf2cdc26af1d83371f2e6206caf5f8b3539737864e6beecb7bbc0  lib/football/worldwide-targets.mjs
df9d7bde4e6c5e46986f533b32bb40c61a9e737f33a28c3e560c5943cedab919  scripts/azure/job.mjs
b53f6a6444b2da03098bf568fcb18bfc129f621e95d5d89a3a442e5c72380dbb  scripts/azure/live-worker.mjs
7633a96b6af388490615c47de564f191e23530e65feede1985d1fb8447d171ec  scripts/azure/start.mjs
c93a1bc821bee621739953dfed074cb864fa2c03c8e41c9f7b40d0df418af99c  scripts/azure/worldwide.mjs
```
