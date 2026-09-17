# Verified migration counts

Verified in Azure at 2026-09-17T09:16:38.682Z. Counts and ordered content SHA-256 matched for all 68 tables after two imports. These are the baseline counts before live Azure jobs changed records. `migration_conflicts` preserves both original row versions for each conflicting key. The migration ledger is metadata and excluded.

| Table | Local small | Local large | D1 export | Reconciled / local PostgreSQL | Azure PostgreSQL baseline | Azure after jobs |
|---|---:|---:|---:|---:|---:|---:|
| `analysis_batches` | 0 | 2 | 1 | 2 | 2 | 2 |
| `analysis_processing` | 0 | 2,070 | 620 | 2,070 | 2,070 | 2,220 |
| `api_request_usage` | 0 | 0 | 0 | 0 | 0 | 0 |
| `calibration_models` | 0 | 0 | 0 | 0 | 0 | 0 |
| `canonical_entities` | 0 | 1,794 | 1,805 | 1,805 | 1,805 | 1,854 |
| `confederations` | 0 | 3 | 3 | 3 | 3 | 3 |
| `countries` | 0 | 272 | 272 | 272 | 272 | 272 |
| `competitions` | 0 | 38 | 39 | 39 | 39 | 40 |
| `country_confederations` | 0 | 8 | 8 | 8 | 8 | 8 |
| `cron_runs` | 0 | 0 | 113 | 113 | 113 | 121 |
| `data_sources` | 0 | 0 | 0 | 0 | 0 | 0 |
| `entity_aliases` | 0 | 1,794 | 1,805 | 1,805 | 1,805 | 1,854 |
| `evidence_conflicts` | 0 | 16 | 16 | 16 | 16 | 16 |
| `football_cache` | 1 | 28 | 1 | 28 | 28 | 21 |
| `football_teams` | 0 | 795 | 805 | 805 | 805 | 814 |
| `football_players` | 0 | 190 | 190 | 190 | 190 | 227 |
| `head_to_head` | 0 | 124 | 127 | 128 | 128 | 138 |
| `media_assets` | 0 | 0 | 0 | 27 | 27 | 27 |
| `entity_media` | 0 | 0 | 0 | 29 | 29 | 29 |
| `media_enrichment` | 0 | 0 | 0 | 985 | 985 | 985 |
| `media_url_checks` | 0 | 0 | 0 | 32 | 32 | 32 |
| `migration_conflicts` | 0 | 0 | 0 | 3,646 | 3,646 | 3,646 |
| `model_parameter_versions` | 0 | 0 | 0 | 0 | 0 | 0 |
| `model_parameters` | 0 | 14 | 14 | 14 | 14 | 14 |
| `model_release_decisions` | 0 | 0 | 0 | 0 | 0 | 0 |
| `model_runtime` | 0 | 0 | 0 | 0 | 0 | 0 |
| `news_articles` | 0 | 274 | 468 | 484 | 484 | 497 |
| `player_form` | 0 | 46 | 46 | 46 | 46 | 46 |
| `provider_limits` | 0 | 0 | 0 | 0 | 0 | 0 |
| `provider_sync_runs` | 0 | 25 | 25 | 25 | 25 | 25 |
| `recommendation_lists` | 0 | 7 | 6 | 9 | 9 | 9 |
| `recommendation_grades` | 0 | 25 | 25 | 33 | 33 | 36 |
| `search_documents` | 0 | 12,779 | 12,733 | 12,779 | 12,779 | 12,992 |
| `search_words` | 0 | 73,842 | 73,439 | 73,850 | 73,850 | 75,993 |
| `seasons` | 0 | 49 | 50 | 50 | 50 | 51 |
| `fixtures` | 0 | 11,795 | 11,801 | 11,801 | 11,801 | 11,807 |
| `analysis_forecasts` | 0 | 0 | 0 | 0 | 0 | 0 |
| `analysis_grade_audit` | 0 | 0 | 0 | 0 | 0 | 0 |
| `analysis_grades` | 0 | 0 | 0 | 0 | 0 | 0 |
| `exploratory_estimates` | 0 | 1,649 | 518 | 1,715 | 1,715 | 1,864 |
| `fixture_events` | 0 | 1 | 1 | 1 | 1 | 1 |
| `fixture_identities` | 0 | 11,795 | 11,801 | 11,801 | 11,801 | 11,807 |
| `fixture_statistics` | 0 | 1 | 1 | 1 | 1 | 1 |
| `football_appearances` | 0 | 31 | 31 | 31 | 31 | 31 |
| `injuries` | 0 | 0 | 0 | 0 | 0 | 0 |
| `lineups` | 0 | 1 | 1 | 1 | 1 | 1 |
| `model_predictions` | 0 | 426 | 426 | 426 | 426 | 438 |
| `prediction_results` | 0 | 0 | 0 | 0 | 0 | 0 |
| `prematch_snapshots` | 0 | 469 | 434 | 469 | 469 | 787 |
| `season_teams` | 0 | 1,268 | 1,278 | 1,278 | 1,278 | 1,287 |
| `source_registry` | 30 | 31 | 30 | 31 | 31 | 31 |
| `field_claims` | 0 | 80,038 | 80,242 | 80,584 | 80,584 | 81,163 |
| `http_response_cache` | 0 | 209 | 26 | 229 | 229 | 239 |
| `social_accounts` | 0 | 7 | 7 | 7 | 7 | 13 |
| `social_evidence` | 0 | 0 | 0 | 0 | 0 | 0 |
| `source_files` | 0 | 3,541 | 3,541 | 3,541 | 3,541 | 3,541 |
| `source_request_usage` | 0 | 20 | 35 | 42 | 42 | 42 |
| `standings` | 0 | 0 | 0 | 0 | 0 | 0 |
| `sync_locks` | 0 | 0 | 2 | 2 | 2 | 0 |
| `team_form` | 0 | 764 | 774 | 774 | 774 | 783 |
| `teams` | 0 | 0 | 0 | 0 | 0 | 0 |
| `matches` | 0 | 0 | 0 | 0 | 0 | 0 |
| `players` | 0 | 0 | 0 | 0 | 0 | 0 |
| `appearances` | 0 | 0 | 0 | 0 | 0 | 0 |
| `predictions` | 0 | 0 | 0 | 0 | 0 | 0 |
| `update_jobs` | 0 | 25 | 24 | 26 | 26 | 26 |
| `verification_queue` | 0 | 49 | 49 | 49 | 49 | 57 |
| `verified_entity_aliases` | 0 | 33 | 33 | 33 | 33 | 33 |

Total reconciled and Azure rows: **212,135**. Snapshot SHA-256: `4ebace4f3f5de5846b94d0edf41b7facb53d366c15b2ddb54d3ae57ddc01eaef`.

Current Azure counts checked at **2026-09-17T10:49:44.888Z** after live job activity: **215,924 rows**. These new counts reflect ingestion, indexing, and existing retention rules; they are not the baseline content-hash assertion.
