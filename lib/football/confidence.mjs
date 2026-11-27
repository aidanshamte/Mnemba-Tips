// Match-result pick and an honest confidence tier for display.
//
// Tiers are probability bands whose measured hit rates differ, measured on prospective forecasts only (latest
// pre-kickoff forecast per real match, production 2026-11-27, 489 settled matches):
//   pick >= 65%  -> 71.7% correct (n=53)    "High"
//   55-65%       -> 57.1% correct (n=98)    "Moderate"
//   below 55%    -> 49.7% correct (n=338)   "Low"
// A tier is never higher than the evidence allows: early (provisional) estimates are at most "Low", and fewer than
// five recorded matches for either team is "Insufficient data". The bands are re-measured on the performance view;
// they are not a promise of future accuracy.
export const CONFIDENCE_BANDS = Object.freeze({high: 0.65, moderate: 0.55, minGames: 5});
const LABEL = {high: 'High confidence', moderate: 'Moderate confidence', low: 'Low confidence', insufficient: 'Insufficient data'};

/** {outcome: 0|1|2, probability, tier, label} or null when there are no match-result probabilities. */
export function matchPick(analysis, fixture = {}) {
  const p = analysis?.probabilities;
  if (!Array.isArray(p) || p.length !== 3 || p.some(x => !Number.isFinite(x))) return null;
  const outcome = p.indexOf(Math.max(...p)), probability = p[outcome];
  const games = [analysis.factors?.homeForm?.games, analysis.factors?.awayForm?.games].filter(Number.isFinite);
  let tier = probability >= CONFIDENCE_BANDS.high ? 'high' : probability >= CONFIDENCE_BANDS.moderate ? 'moderate' : 'low';
  if (analysis.estimateKind && analysis.estimateKind !== 'tracked') tier = 'low';
  if (games.length === 2 && Math.min(...games) < CONFIDENCE_BANDS.minGames) tier = 'insufficient';
  const name = outcome === 0 ? fixture.home?.name : outcome === 2 ? fixture.away?.name : null;
  return {outcome, probability, tier, label: LABEL[tier], pick: outcome === 1 ? 'Draw' : `${name ?? (outcome === 0 ? 'Home' : 'Away')} win`};
}
