# PitchPredict AI Studio

A responsive two-sport analytics system for soccer and basketball. It combines open-data connectors, a normalized sports database, recent-form scoring, head-to-head analysis, projected lineups and transparent probability estimates.

The global football desk is at `/` and `/football`, with keyless fixtures, historical results, news, source diagnostics and evidence-aware analysis. The original basketball and scenario dashboard is preserved at `/lab`, and the advanced football workspace at `/football/classic`. See [INTELLIGENCE.md](INTELLIGENCE.md) for the new adapters, Windows updates, provenance, snapshots, commands and coverage limits; [FOOTBALL.md](FOOTBALL.md) documents the existing provider workflows.

## Included

- Soccer 1X2, expected goals, BTTS and over/under projections
- Basketball winner, projected score and projected total
- Recency-weighted team form and availability-adjusted player strength
- Probable soccer XI and projected basketball starting five
- Head-to-head history and model explanations
- OpenFootball connector endpoint
- D1/SQLite schema for sources, teams, players, matches, appearances and stored predictions
- Responsive dark sports-intelligence dashboard
- Unit and system tests

## Run locally

1. Install Node.js 22+ and pnpm.
2. Run pnpm install.
3. Run pnpm dev.
4. Open the local address shown in the terminal.

Run pnpm test for unit and system tests. Run pnpm build for a production build.

## Data integrity

The included matchups are labeled model scenarios so they cannot be mistaken for current live facts. Open dataset connectors are designed to normalize source records into the shared database. Confirmed injuries, live scores and official team sheets require a licensed live provider.

See ARCHITECTURE.md for the provider and model design.
