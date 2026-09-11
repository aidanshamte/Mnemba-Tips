# PitchPredict AI Studio

## Product boundary

PitchPredict separates three states so the interface never implies false certainty:

1. Historical records: imported from reusable open datasets.
2. Model projections: calculated from rating, weighted form, head-to-head history, venue and recorded player availability.
3. Confirmed live facts: shown only when a licensed real-time provider is connected.

## Data providers

- OpenFootball: public-domain fixtures, teams and results.
- StatsBomb Open Data: selected soccer events and lineups; attribution is required.
- SportsDataverse hoopR: basketball schedules, rosters, box scores and play-by-play; CC BY 4.0.

Each connector normalizes records into the data-sources, teams, players, matches, and appearances tables. The dashboard and prediction model consume only this normalized layer.

## Prediction model

The included deterministic baseline blends team rating, recency-weighted form, availability-adjusted player strength, head-to-head record and a home advantage. Soccer totals use a Poisson baseline. Basketball uses pace and attack strength. The design intentionally makes each factor replaceable by a trained model later.

## Production roadmap

- The global football workspace now implements browser-lifecycle scheduling, D1 upserts, namespaced API-Football/Football-Data providers, verified RSS metadata, historical imports and daily quota accounting. See [FOOTBALL.md](FOOTBALL.md) for the implemented architecture and its coverage boundaries.
- Football pre-kickoff predictions are stored as immutable versions and evaluated with Brier score and winner accuracy after final results. Injuries, confirmed lineups and projections retain separate labels.
- Train and calibrate league-specific models against held-out data before making accuracy claims.
- Add authentication before exposing the currently localhost-only synchronization and diagnostics remotely.
