# LiveScore production completion — 24 September 2026

This checkpoint supersedes the disabled-candidate status in the September 21 record below.

**Current status: real production ingestion and the representative match are verified; continuous operation still needs the prepared worker fix deployed.** The first release's autonomous worker received `{}` for unpublished UAE–Yemen incidents. Its strict identity check paused all LiveScore tasks for five minutes. A two-file correction in `livescore.mjs` and `live.mjs` now recognizes unpublished details, preserves prior details, and defers only that match/task. Wrong nonempty identities still reject. Ten focused tests pass, including the observed empty envelopes and provider isolation. Prepared local image `mnembab55deec1.azurecr.io/mnemba:livescore-detail-20260924` is **not pushed or deployed**. User approval is pending because the one-deployment limit has already been used. No further application build is needed: the correction affects the background worker's raw modules only; HTTP/SSE snapshot readers are unchanged.

**Hourly job result:** `mnemba-update-0-nusjxcy` no longer exited 137. It recorded `partial`, exited 1, and reports `models: Scheduled run deadline exceeded` at 16:01:26 UTC. The 16:00 natural execution succeeded only by skipping the overlapping active job; it is not proof of a successful full scheduler run. The existing model-stage deadline remains unresolved; no ML implementation was changed. One web restart with exit 1 was also observed; its exact cause was not established by available console logs. Do not claim uninterrupted worker operation.


## Completed

- Reused the existing Phase-2 worker, canonical evidence, PostgreSQL tables, snapshots, SSE and match UI. No schema migration, logos, ML, historical imports or UI changes.
- Applied the project owner's existing LiveScore authorization from the final production handoff; Perform/Opta remains disabled.
- Verified the existing `/api/v2/live/soccer/1` endpoint directly. Implemented its real `Sctns/Ts/Evs` envelope, Unix-second kickoff, minute/status and stable identities. Public scoreboard uses `Stg` and compact UTC kickoff, corroborated against discovery timestamps. Missing season labels retain provider stage identity with an explicitly labelled kickoff-calendar-year bucket.
- Incidents use `Incs` period groups and composite event keys: player ID alone does not identify a goal. Unknown numeric event types remain labelled as provider event codes; score-bearing incidents are goals. Lineups use `Lu/Ps`, `Tnb`, `Fo` and `Fp` to preserve both formations and starters. No inferred Opta data.
- Worker discovery records raw/accepted/rejected/inserted/updated/persisted counts, publishes existing snapshots, and retains final-match incident/lineup polling. Protected `view=live-health` exposes diagnostics; anonymous access stays denied.
- Azure web and all existing jobs use `MNEMBA_LIVESCORE_ENABLED=1`. Existing web worker remains enabled with minimum one replica. Local ceiling: 1,500 requests/day (application limit, not a claimed vendor entitlement).
- Production worker at 15:53:39 UTC: **LiveScore raw 3, accepted 3, inserted/persisted 3, rejected 0**. All are real current fixtures; no synthetic production data.

## Release and tests

- Ready revision: `mnemba-web--0000014`.
- Image: `mnembab55deec1.azurecr.io/mnemba@sha256:de2df148b4fb3e54ea4800fb275dc6afc7070187e43b261ab9f8af1b582c1411`.
- One successful build/image/deployment. Deployment preparation initially stopped on local disk exhaustion before Azure changes; the same image was then deployed.
- 26 targeted tests plus one actual isolated PostgreSQL test passed; Azure TypeScript and build passed. Captured real-response tests cover UTC equality, same-player multiple goals, 11 starters per team, canonical persistence and live publication.
- Existing 70,677,001-byte private Azure backup verified; PostgreSQL seven-day recovery retained. Previous revision/image saved in `.sites-runtime/livescore-production/rollback.json`.
- Exit-137 mitigation in this release: existing hourly job increases from 0.5 CPU/1 GiB to 1 CPU/2 GiB with Node heap capped at 1,024 MiB. Before release, measured memory reached 867 MiB near termination. This supports memory pressure as a hypothesis, not a confirmed OOM reason. Post-release execution result recorded below.

Production verification: Uzbekistan–Iran (`livescore:1894365`) persisted a real 3–1 score at 90 minutes, three supplied incidents, both 4-2-3-1 formations and 11 starters per team. Azure verification used the real adapter under the existing synchronization lease. Public HTTP and SSE replay matched the persisted snapshot. Desktop/mobile match pages displayed score, incidents and team sheets without errors; basketball passed. Today's main browser contains six fixtures from TheSportsDB and LiveScore together. Anonymous live-health access returned 403.

The local workspace filled during packaging; generated Azure CLI files, old browser captures and local backup copies were preserved under `/tmp/mnemba-preserved-*-20260924` with symlinks at their original paths. The separately verified private Azure backup remains durable.

Post-release job verification follows. Protected evidence: `.sites-runtime/livescore-production/`.

---

# Live pipeline checkpoint — 21 September 2026

This extends the existing football system. No schema migration or replacement provider system is introduced.

## Implemented

- Central Azure worker shares the web container and uses PostgreSQL advisory election plus the existing football-sync lease. Scheduled jobs retain their schedules and commands. Public HTTP/SSE requests never initiate provider ingestion.
- Existing API-Football and football-data.org parsers, source permissions, canonical evidence, caches and quota limits are reused. Discovery includes today's scheduled, half-time and final matches. Match details are updated independently; final matches receive reduced polling. Failures preserve the previous snapshot and back off.
- Meaningful fixture/detail differences are persisted through existing stores. Incidents are deduplicated, detail corrections retain source claims, and an atomic current snapshot is published after successful writes. No prediction implementation is replaced; live snapshots cannot overwrite saved pre-match forecasts.
- `/api/football/live?id=…` serves current persisted state. `&stream=1` provides bounded SSE connections with heartbeat, reconnect and current-state replay. Reads coalesce per web process. Existing match pages update score/status/minute, supplied events, formation, lineups and statistics; HTTP polling is the fallback. Match lists retain their existing one-minute refresh.
- Free-provider polling remains constrained by existing 100/day API-Football and 500/day application ceilings. Five-minute active detail intervals, slower half-time/lineup/statistics intervals and 30-minute discovery are scheduling targets, not live-service latency guarantees; global task selection and quotas can delay them further. No new subscription or Redis service.

## LiveScore: disabled contract candidate

`config/live-sources.json` is deliberately disabled. `lib/football/livescore.mjs` contains a strict candidate parser and guarded discovery/scoreboard/incidents/lineups adapter. Its tests use synthetic examples, **not captured vendor responses**. These field mappings and envelopes are not verified against LiveScore and may require correction before enabling it.

The supplied investigation identified hosts and paths, but did not supply a discovery URL, response samples, timezone contract, service quotas, or written automation/storage/public-display permission. Merely setting `MNEMBA_LIVESCORE_ENABLED=1` cannot activate it. Activation requires reviewed permission evidence, all permission flags, a verified schema flag, a positive request budget, and a configured discovery URL on `prod-cdn-mev-api.lsmedia1.com`. Public match paths are restricted to the three supplied resources on `prod-cdn-public-api.lsmedia1.com`; arbitrary hosts and resources are rejected. Unknown statuses, absent identities and ambiguous date/time values are rejected.

Perform/Opta `api.performfeeds.com/soccerdata` is not called. Its configuration remains disabled and detailed-matchstats operations explicitly reject requests. A separate written third-party grant and sanitized response contract are required to implement its parser; no outlet tokens, cookies or browser-session material are used.

## Genuine production blockers

The existing Azure web container has no `API_FOOTBALL_KEY` or `FOOTBALL_DATA_KEY`; LiveScore lacks the permission and contract evidence above. Therefore the deployed worker can run, but **no authorized live feed is currently configured**. No actual provider-to-production live update is claimed. API-Football registration: https://dashboard.api-football.com/register ; football-data.org registration: https://www.football-data.org/client/register . Account entitlements must be verified before promising live coverage.

The existing Azure app previously had zero minimum replicas. A continuously running background worker requires one existing web replica to remain running, increasing its running time without creating a separate paid service. Provider keys remain server-side.

## Verification

- Targeted tests: permission gating/no network requests when disabled; strict candidate parsing; incident deduplication; canonical persistence; update diffing; forecast preservation; lease contention; failure/backoff; SSE changes, replay and cancellation.
- Final complete suite: 132 tests passed, zero skipped, including actual isolated PostgreSQL integration.
- Typecheck passes. Lint passes for the newly introduced modules. Unrelated existing lint debt is not claimed fixed.
- Azure production build passes. Exactly one Docker image was built and deployed: `live-20260921`, digest `sha256:d3857fb8df980c8089effd3583dd16fe369455c9ecdec220855f495f17a940fa`.
- Ready Azure web revision: `mnemba-web--0000011`. All three scheduled jobs use that digest with their existing commands and UTC schedules. Minimum web replicas changed from 0 to 1; no additional Azure service was created.
- Isolated actual PostgreSQL → SSE → desktop/mobile browser score/incident updates pass. Saved pre-match analysis stayed unchanged. HTTP fallback also passed. Synthetic snapshot data was confined to the isolated rehearsal and restored afterward; none was injected into production.
- Production health reports database ready. A real persisted fixture's SSE route returns HTTP 200 with an explicit unavailable state, as no authorized live feed is configured. Protected diagnostics still return 403 anonymously.
- Production browser checks pass desktop/mobile football, fixtures, search, match pages, prediction/history pages, news, player profiles, basketball scenarios and the legacy redirect. No uncaught page errors were recorded.
- Worker startup and a subsequent heartbeat were observed in Azure logs at 03:08:50 and 03:13:50 UTC with `mnemba_live {"state":"not-configured"}`. It runs in Azure independently of Codespaces. Actual provider-to-production score changes remain unverified and blocked.
- New-image hourly verification `mnemba-update-0-sih0f3q` succeeded in Azure at 03:13:51 UTC: models/media succeeded; fixtures/results/snapshots were not due. The prior natural 03:00 execution also succeeded. All schedules remain configured; the daily and secondary jobs were not redundantly rerun.
- Existing durable football backup was verified in private Azure storage before deployment. No migration or table recreation occurred. Protected build/test/browser/job evidence is retained in `.sites-runtime/live-release/`.

## Deferred

Worldwide coverage expansion, optional imagery/news repairs, new models and in-play predictions remain outside this session. Existing records and previously saved forecast versions are preserved.
