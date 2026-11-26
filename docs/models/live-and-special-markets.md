# In-play and special-market models

Written for maintainers. Criteria below were fixed on 2026-11-25, before any results existed.

## In-play (`inplay-poisson-1`, provisional)
- **Inputs:** the verified score, status and minute; the pre-match expected goals of the latest saved forecast made before kickoff (own or linked record), else the same model applied to results recorded before kickoff, labelled "historical baseline"; red cards from the source's card counts or events.
- **Model:** each team's remaining regulation goals are Poisson with the pre-match rate scaled by the remaining minutes. The remaining minutes are a mixture over stoppage-time scenarios (first half 1–6 minutes, second half 2–9 minutes; these are stated assumptions, not fitted values). At a capped 45′ or 90′ the elapsed stoppage is unknown, so half of each scenario is taken to remain. Remaining time is never zero.
- **Not modelled, stated on every estimate:**
  - score-state effects;
  - red-card effects (a dismissal raises the uncertainty to High);
  - live statistics.

  Missing card information is reported, never read as "no red cards".
- **Not offered:** extra time and penalties (the regulation markets are already settled), interruptions, outcomes already resolved (for example over 2.5 and both teams to score at 2–2), and stale or conflicting input. Stale means the match was not observed in the last 3 minutes; the estimate is then shown as "Live prediction paused — waiting for fresh data", and the previous one stays visible with its own time.
- **Markets:** final result (regulation), double chance, unresolved full-match totals, both teams to score (only while unresolved), another goal, and next goal (home, away or none).
- **Snapshots:** stored in `live_snapshots`, one per verified change of score, status or red cards, and at least every 5 minutes of play. They are computed by the live worker only; page requests never trigger modelling.
- **Settlement (`live_grades`):**
  - Final-score markets use the verified regulation result.
  - Next goal settles only from a complete goal sequence with known sides and no own goals; otherwise it is `unresolved`.
  - Abandoned or cancelled matches are void.
  - A changed result keeps the prior settlement in `revisions`.
- **Abandoned matches (`abandoned` state):** markets already decided when play stopped stand. That means a total line already exceeded, both teams having scored, another goal having occurred, and the next goal if a complete goal sequence shows it. Everything else, including the result and double chance, is void. If the score at abandonment is unknown, everything is void. Pre-match forecasts for abandoned matches keep their established rule: withheld, and not counted in accuracy.
- **Reporting:** separate from pre-match forecasts, by minute band, with each match weighted once per band.

## Corners and cards (`special-nb-1`, provisional)
- **Data:** the source's full-match counts (5DollarFootballAPI `corners`, and `cards` as yellow + red). Booking points are not used. A second yellow is counted as the source counts it.
- **Model:** team rates for and against over the last 20 matches with counts, shrunk toward the pool mean with 5 pseudo-matches and paired multiplicatively. Counts are negative binomial, with dispersion estimated from the pool's match totals. Expected goals and result probabilities are not used.
- **Eligibility:** each team needs 10 recorded matches with counts; otherwise the market is withheld with the reason.
- **Settlement:** from the same counts on the graded fixture. A missing count stays pending, never a loss.
- **Not available:**
  - shots and shots on target: per-match history is too thin (statistics rows exist for few matches);
  - player markets: there is no verified participation or minutes data. Substitution names only.
  - referee effects: the assigned referee is not verified.

## Promotion criteria (fixed before evaluation)
Neither family enters Top picks or headline accuracy while provisional. A family qualifies only when **all** of these hold on settled, leakage-safe data that was never used to choose parameters:
1. **Sample:** at least 300 distinct matches. For in-play, at least 100 matches in each of the 6 minute bands. Snapshots of one match stay together.
2. **Chronological split:** an earlier half for checks and a later half held out.
3. **Accuracy:** in both halves the Brier score is better than a simple baseline:
   - in-play: the pre-match forecast probabilities, unchanged;
   - corners and cards: the pool's base rate for each line.
4. **Calibration:** calibration error at most 0.05 in deciles that contain at least 30 matches.
5. **Recording:** the result is recorded in `model_release_decisions`, one locked evaluation per model version. Later changes need a new version and a later cohort.

If a family fails, it stays provisional. The current production pre-match model (`poisson-temporal-1`) and its existing candidate evaluation (`dc-candidate-1`, 200 paired forecasts in two chronological blocks) are unchanged.
