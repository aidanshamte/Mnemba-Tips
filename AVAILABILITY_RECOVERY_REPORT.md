# Production availability recovery — 26 September 2026

Production HTTP was restored at approximately 02:17 UTC. The final worker-enabled revision, `mnemba-web--recovery-live`, started at 02:26:50 UTC and receives 100% traffic. The image is `mnembab55deec1.azurecr.io/mnemba@sha256:ffb5776835728742d6e00ac12221ff897109fdd6229fd7ec7fcace8f4f6ed92c`.

## Demonstrated failure

The previous revision `mnemba-web--0000014` was misleadingly labelled Healthy in the revision summary, but its only replica was not ready and in CrashLoopBackOff, with 309 restarts at initial inspection. Both the Azure hostname and custom domain timed out; the custom domain occasionally returned HTTP 200 during brief running windows. System logs reported repeated exit code 1 / ProcessExited.

Direct `/proc` inspection identified the live worker as the memory consumer: its RSS rose from 296,932 KiB to 852,932 KiB within seconds, while Next.js remained at 103,976–148,688 KiB. The container's memory limit was 1,073,741,824 bytes. Azure working-set metrics reached 1,097,256,960 bytes in the preceding hour. This was not diagnosed from exit code 137: the supervisor translated child failure into container exit 1 and stopped both children.

An instrumented production worker cycle traced the allocation to `IntelligenceService.saveFixtures` calling `ModelLab.grade`. Its unbounded `SELECT p.*, f.payload ... FROM analysis_forecasts ...` loads the forecast archive into the live worker. Read-only SQL confirmed 1,205,072,824 bytes of `evidence_ids` alone (versus only 6,004,225 bytes of forecast `payload`), exceeding the container limit before JavaScript allocation overhead. The diagnostic process disappeared during that query. Live fixture ingestion also invoked prediction recomputation. These model operations belonged to scheduled processing, yet ran inside the web container's live worker. The supervisor then coupled worker failure to website shutdown.

PostgreSQL itself reported Ready: preceding-hour CPU maxima were 19–34%, connections 8–15, storage about 19.4%, and database-backed public health passed immediately after the worker was isolated. No domain/TLS/ingress configuration was changed.

## Minimal recovery

1. Temporarily set only the web app's `MNEMBA_ENABLE_UPDATES=0`, creating `mnemba-web--recovery-web` with the original image. HTTP health recovered to 200 in about 0.2 seconds, with zero restarts.
2. Added an internal `liveOnly` save option. Live ingestion keeps fixture/team/competition persistence, canonical evidence, cache invalidation and live snapshots, but skips prediction recomputation, evaluation and full-archive grading. Default scheduled behavior is unchanged.
3. Changed the supervisor so a live-worker exit is logged and retried after 60 seconds without terminating Next.js. Applied a 256 MiB worker V8 heap cap; Azure CPU/memory allocations are unchanged. Restored original service methods after each live tick rather than accumulating bound wrappers.
4. Included the previously tested unpublished `{}` detail-response fix, which was absent from revision 0000014. Missing detail is deferred per fixture/task; incorrect nonempty identities still reject.
5. Packaged only `service.mjs`, `intelligence.mjs`, `live.mjs`, `livescore.mjs`, and `scripts/azure/start.mjs` on the exact existing production image. The compiled frontend is unchanged. Local BuildKit snapshot metadata prevented Dockerfile packaging; copying those same five files into the extracted production container and committing it produced the final image. No application rebuild occurred.
6. Deployed the final digest and restored `MNEMBA_ENABLE_UPDATES=1`. Scheduled jobs retain their original images/configurations.

## Verification

- New regression tests prove live ingestion avoids archive/model queries while preserving canonical identity and live state; worker failure leaves the web child alive.
- Focused tests: 12 passed, zero failed, one optional PostgreSQL test skipped because no isolated test database was configured. Actual production ingestion subsequently succeeded.
- Real final-revision discovery at 02:26:51 UTC: raw 8, accepted 8, persisted 8, rejected 0.
- Homepage, `/football`, Azure FQDN and `/api/health` respond HTTP 200. Football overview, matchday and live APIs pass.
- Desktop 1440px and mobile 390px production checks pass for football, prediction archive and basketball, without uncaught page errors or horizontal overflow.
- Preserved Uzbekistan–Iran snapshot: 3–1, three recorded incidents, two lineups, 11 starters each. It remains the existing snapshot, not a newly asserted final-match status.
- SSE replays the persisted snapshot while parallel health responds HTTP 200 in 214ms. Public requests read persisted data, not provider feeds; streams expire after 55 seconds.
- Initial read-only counts: 37,784 fixtures, 37,784 fixture identities, 3,032 entity aliases, 707 analysis forecasts, two lineup records and four incident records. Existing `predictions` table was already empty; tracked forecasts live in `analysis_forecasts`.
- No database recreation, migration, forecast deletion, historical import, DNS/certificate change, or resource increase occurred.

## Separate remaining issue

The September 24 model-stage timeout was not the website's root cause. Current database evidence shows the most recent model stage succeeded on September 25 at 12:04 UTC, with no stored model error. The 01:00 and 02:00 hourly runs on September 26 recorded partial/deferred fixture work because another synchronization held the lease during the crash loop. The next natural hourly execution has not yet been observed after recovery. Scheduled jobs retain 1 CPU / 2 GiB and a 1,024 MiB Node heap for the hourly job. Full-archive grading remains a memory-heavy operation in that separate job and should be addressed in later scoped work. No prediction-engine redesign was attempted.

## Final observation

At approximately 02:33 UTC, the final revision remained ready with zero restarts after more than six minutes. Azure memory samples during traffic were approximately 198–277 MiB and peak CPU about 0.15 cores against the unchanged 0.5-core allocation. The final container reported `oom_kill 0`; the worker RSS was about 93 MiB. Repeated health checks passed in 211–262ms. Final-revision desktop/mobile match checks confirmed the preserved 3–1 scoreboard and team sheets.

The later discovery at 02:31:56 UTC reported raw 7, accepted 7, persisted 7, rejected 0. Unpublished detail responses were deferred per task while subsequent cycles continued. Final database counts: 37,785 fixtures and fixture identities, 3,035 entity aliases, 707 analysis forecasts, 607 model predictions, and 28,617 exploratory estimates. The analysis-forecast immutable update/delete triggers are still present. Growth in fixtures reflects normal live ingestion; no existing forecast was removed.

Protected evidence and screenshots are stored under `.sites-runtime/availability-20260926/`.
