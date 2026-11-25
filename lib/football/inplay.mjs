// General in-play model: what can still happen in the remaining regulation time, for any eligible live fixture and any
// valid score. Baseline (documented, deliberately simple): each team's remaining goals are Poisson with the pre-match
// expected goals scaled by the remaining playing time; remaining time is a mixture over stoppage-time scenarios.
// Not modelled (stated as limitations, not silently assumed): score-state effects, red-card effects, live statistics.
import {digest} from './digest.mjs';
import {matchTimeline} from './events.mjs';

export const INPLAY_MODEL = 'inplay-poisson-1';
export const FRESH_MS = 3 * 60000, SNAPSHOT_EVERY_MS = 5 * 60000;
// Stoppage-time scenarios in minutes with weights. Assumptions, not fitted parameters; shown in Details.
const S1 = [[1, .15], [2, .25], [3, .25], [4, .18], [5, .1], [6, .07]];
const S2 = [[2, .05], [3, .12], [4, .18], [5, .2], [6, .17], [7, .12], [8, .09], [9, .07]];
const LIVE = new Set(['1H', 'HT', '2H']);

const norm = w => { const t = w.reduce((n, [, p]) => n + p, 0); return w.map(([m, p]) => [m, p / t]); };
const combine = (a, b, offset = 0) => norm(a.flatMap(([x, p]) => b.map(([y, q]) => [x + y + offset, p * q])));
// Remaining stoppage when the clock already shows m minutes past the period end (provider may cap the minute at 45/90,
// so being "at" the end means the elapsed stoppage is unknown; then the remaining part is taken as half the scenario).
function stoppageLeft(dist, over, capped) {
  if (capped) return norm(dist.map(([s, p]) => [Math.max(0.5, s / 2), p]));
  const left = dist.filter(([s]) => s > over).map(([s, p]) => [s - over, p]);
  return left.length ? norm(left) : [[0.5, 1]];
}

/** Remaining regulation minutes as a weighted mixture, or a reason why the state is not modelled. */
export function remainingTime(status, elapsed) {
  const s = String(status ?? '').toUpperCase();
  if (s === 'HT') return {mixture: S2.map(([x, p]) => [45 + x, p])};
  if (!['1H', '2H'].includes(s)) return {reason: ['ET', 'BT', 'P'].includes(s) ? 'Extra time or penalties: the regulation-time result is settled and extra time is not modelled.' : ['SUSP', 'INT', 'PAUSED', 'SUSPENDED', 'INTERRUPTED'].includes(s) ? 'Match interrupted.' : 'Match is not in regulation play.'};
  if (!Number.isFinite(elapsed) || elapsed < 0) return {reason: 'Match minute unavailable from the source.'};
  if (s === '1H') {
    if (elapsed > 50) return {reason: 'First-half minute out of range.'};
    const first = elapsed < 45 ? S1.map(([x, p]) => [45 - elapsed + x, p]) : stoppageLeft(S1, elapsed - 45, elapsed === 45);
    return {mixture: combine(first, S2, 45)};
  }
  if (elapsed < 45 || elapsed > 105) return {reason: 'Second-half minute out of range.'};
  return {mixture: elapsed < 90 ? S2.map(([x, p]) => [90 - elapsed + x, p]) : stoppageLeft(S2, elapsed - 90, elapsed === 90)};
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

/** Markets for the rest of regulation time. Resolved outcomes are never offered. */
export function inplayMarkets({home, away, lambda, mixture}) {
  const MAX = 10, grid = Array.from({length: MAX + 1}, () => Array(MAX + 1).fill(0));
  let next = {home: 0, away: 0, none: 0};
  for (const [t, w] of mixture) {
    const lh = lambda[0] * t / 90, la = lambda[1] * t / 90;
    for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) grid[i][j] += w * pois(i, lh) * pois(j, la);
    const none = Math.exp(-(lh + la)), share = lh + la > 0 ? lh / (lh + la) : .5;
    next.none += w * none; next.home += w * (1 - none) * share; next.away += w * (1 - none) * (1 - share);
  }
  let H = 0, D = 0, A = 0, mass = 0; const total = {};
  for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) {
    const p = grid[i][j], h = home + i, a = away + j; mass += p;
    if (h > a) H += p; else if (h === a) D += p; else A += p;
    total[h + a] = (total[h + a] ?? 0) + p;
  }
  [H, D, A] = [H / mass, D / mass, A / mass];
  const now = home + away, totals = [];
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) if (now < line) {
    const over = Object.entries(total).filter(([g]) => Number(g) > line).reduce((n, [, p]) => n + p, 0) / mass;
    totals.push({line, over, under: 1 - over});
  }
  const pAnother = 1 - next.none, btts = home > 0 && away > 0 ? null : (() => {
    // P(both teams have scored by the end), counting only what is still needed.
    const needH = home === 0, needA = away === 0; let p = 0;
    for (const [t, w] of mixture) { const ph = needH ? 1 - Math.exp(-lambda[0] * t / 90) : 1, pa = needA ? 1 - Math.exp(-lambda[1] * t / 90) : 1; p += w * ph * pa; }
    return p;
  })();
  return {result: {home: H, draw: D, away: A}, doubleChance: {homeOrDraw: H + D, drawOrAway: D + A, homeOrAway: H + A}, totals,
    ...(btts == null ? {} : {btts: {yes: btts, no: 1 - btts}}), anotherGoal: pAnother, nextGoal: next,
    expectedRemainingMinutes: mixture.reduce((n, [t, w]) => n + t * w, 0)};
}

/** Red cards from the fixture's card counts or verified events; null when the source gives no card information. */
export function redCards(f, events) {
  if (f.cards?.home && f.cards?.away && Number.isFinite(f.cards.home.red) && Number.isFinite(f.cards.away.red)) return {home: f.cards.home.red, away: f.cards.away.red, source: 'card counts'};
  if (Array.isArray(events) && events.flat().length) { const t = matchTimeline(events, f).events; return {home: t.filter(e => ['red', 'second-yellow'].includes(e.kind) && e.side === 'home').length, away: t.filter(e => ['red', 'second-yellow'].includes(e.kind) && e.side === 'away').length, source: 'match events'}; }
  return null;
}

/**
 * Pure evaluation of one observed state. `baseline` = {lambda:[h,a], basis, forecastId?, forecastAsOf?}.
 * Returns {state:'live'|'paused'|'unavailable', reason?, markets?, limitations, input}.
 */
export function evaluateInplay(f, {observedAt, now, baseline, events}) {
  const input = {status: f.status, elapsed: f.elapsed ?? null, home: f.homeScore, away: f.awayScore, observedAt};
  const limitations = ['Assumes constant scoring rates for the rest of the match; score-state effects are not modelled.', 'Stoppage time is a range of scenarios, not a known value.'];
  if (!LIVE.has(String(f.status).toUpperCase())) { const r = remainingTime(f.status, f.elapsed); return {state: 'unavailable', reason: r.reason ?? 'Match is not in play.', input, limitations}; }
  if (!Number.isInteger(f.homeScore) || !Number.isInteger(f.awayScore)) return {state: 'paused', reason: 'Live prediction paused — waiting for fresh data (score unavailable).', input, limitations};
  if (!Number.isFinite(observedAt) || now - observedAt > FRESH_MS) return {state: 'paused', reason: 'Live prediction paused — waiting for fresh data.', input, limitations};
  if (f.hasConflict && (f.conflictFields ?? []).some(x => /score|status/i.test(x))) return {state: 'paused', reason: 'Live prediction paused — sources disagree on the score or status.', input, limitations};
  const r = remainingTime(f.status, f.elapsed);
  if (!r.mixture) return {state: 'unavailable', reason: r.reason, input, limitations};
  if (!baseline?.lambda) return {state: 'unavailable', reason: baseline?.reason ?? 'No pre-match team-strength estimate: at least three recorded results per team are needed.', input, limitations};
  const reds = redCards(f, events);
  if (!reds) limitations.push('Red-card information is unavailable from this source; the estimate cannot account for dismissals.');
  else if (reds.home + reds.away > 0) limitations.push(`A red card has been shown (${reds.home}–${reds.away}); this baseline does not adjust for it, so uncertainty is higher.`);
  if (baseline.basis === 'historical-baseline') limitations.push('No saved pre-match forecast: team strength comes from recorded results before kickoff.');
  const markets = inplayMarkets({home: f.homeScore, away: f.awayScore, lambda: baseline.lambda, mixture: r.mixture});
  const uncertainty = reds && reds.home + reds.away === 0 && baseline.basis === 'pre-match-forecast' ? 'Moderate' : 'High';
  return {state: 'live', markets, uncertainty, limitations, input: {...input, redCards: reds}, baseline: {basis: baseline.basis, lambda: baseline.lambda, forecastId: baseline.forecastId ?? null, forecastAsOf: baseline.forecastAsOf ?? null}};
}

/** Pre-match team strength for a live fixture: the latest saved forecast before kickoff (own or linked record), else history. */
export async function inplayBaseline(service, f) {
  const s = service.store, ids = [f.id, ...(await s.all('SELECT b.fixture_id FROM fixture_identities a JOIN fixture_identities b ON a.canonical_id=b.canonical_id WHERE a.fixture_id=? AND b.fixture_id<>a.fixture_id', f.id)).map(r => r.fixture_id)];
  const rows = await s.all(`SELECT p.id,p.as_of,p.payload,x.payload fx FROM analysis_forecasts p JOIN fixtures x ON x.id=p.fixture_id WHERE p.fixture_id IN (${ids.map(() => '?').join(',')}) AND p.model_version='poisson-temporal-1' AND p.as_of<p.kickoff_at ORDER BY p.as_of DESC LIMIT 5`, ...ids);
  const canon = await service.aliasMap([f.home.id, f.away.id]), key = id => canon.get(id) ?? id;
  for (const r of rows) {
    const p = JSON.parse(r.payload), g = JSON.parse(r.fx);
    if (!Array.isArray(p.expectedGoals)) continue;
    const m = await service.aliasMap([g.home.id, g.away.id]), gk = id => m.get(id) ?? id;
    const same = gk(g.home.id) === key(f.home.id) && gk(g.away.id) === key(f.away.id), flipped = gk(g.home.id) === key(f.away.id) && gk(g.away.id) === key(f.home.id);
    if (same) return {lambda: p.expectedGoals, basis: 'pre-match-forecast', forecastId: r.id, forecastAsOf: Number(r.as_of)};
    if (flipped) return {lambda: [p.expectedGoals[1], p.expectedGoals[0]], basis: 'pre-match-forecast', forecastId: r.id, forecastAsOf: Number(r.as_of)};
  }
  const {project} = await import('./model.mjs');
  const history = await service.history(f.home.id, f.away.id, f.startsAt, f.id), est = project(f, history);
  return est.expectedGoals ? {lambda: est.expectedGoals, basis: 'historical-baseline'} : {reason: est.reason ?? 'No pre-match team-strength estimate.'};
}

/** When this match was last observed by a live feed (not when the feed last ran): listed in the latest batched live
 * response (5DollarFootballAPI), its own successful poll (LiveScore), or its stored change/observation time. */
export async function matchObservedAt(s, f, updatedAt, tick) {
  let seen = null;
  if (f.provider === 'fivedollar') { const t = tick ?? (await s.cache('live:fdfa:tick'))?.data; if (t?.ids?.includes(f.id)) seen = t.observedAt; }
  else { const c = await s.cache(`live:poll:selected:${f.id}`); if (c && !c.data?.state) seen = Number(c.updatedAt); }
  return Math.max(Number(updatedAt) || 0, Number(seen) || 0) || null;
}

/**
 * Central capture, called by the live worker after a verified state change. Stores a compact immutable snapshot when the
 * score, status or red cards change, or every 5 minutes of play; the latest result (including pauses) is cached for pages.
 */
export async function captureInplay(service, id) {
  const s = service.store, row = await s.one('SELECT payload,updated_at FROM fixtures WHERE id=?', id); if (!row) return null;
  const f = JSON.parse(row.payload), now = s.now();
  // Observation time of this match, not of the feed in general: listed in the latest batched live response
  // (5DollarFootballAPI), or its own successful poll (LiveScore). A stored change time is the fallback.
  const observedAt = await matchObservedAt(s, f, row.updated_at);
  const ev = await s.one('SELECT payload FROM fixture_events WHERE fixture_id=?', id), events = ev ? JSON.parse(ev.payload) : null;
  const baseline = LIVE.has(String(f.status).toUpperCase()) ? await inplayBaseline(service, f) : null;
  const result = evaluateInplay(f, {observedAt, now, baseline, events});
  const latest = {...result, fixtureId: id, modelVersion: INPLAY_MODEL, createdAt: now, provisional: true};
  if (result.state === 'live') {
    const reds = result.input.redCards, stateKey = [f.status, f.homeScore, f.awayScore, reds ? `${reds.home}-${reds.away}` : 'na'].join('|');
    const prev = await s.one('SELECT id,created_at,payload FROM live_snapshots WHERE fixture_id=? AND model_version=? ORDER BY created_at DESC LIMIT 1', id, INPLAY_MODEL);
    const prevKey = prev ? JSON.parse(prev.payload).stateKey : null;
    if (!prev || prevKey !== stateKey || now - Number(prev.created_at) >= SNAPSHOT_EVERY_MS) {
      const snapId = await digest([id, INPLAY_MODEL, stateKey, f.elapsed ?? '', now]);
      const canonical = (await s.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?', id))?.canonical_id ?? null;
      await s.run('INSERT OR IGNORE INTO live_snapshots(id,fixture_id,canonical_id,model_version,created_at,observed_at,minute,payload) VALUES(?,?,?,?,?,?,?,?)', snapId, id, canonical, INPLAY_MODEL, now, observedAt, f.elapsed ?? null,
        JSON.stringify({stateKey, input: result.input, markets: result.markets, baseline: result.baseline, uncertainty: result.uncertainty, limitations: result.limitations, kickoff: f.startsAt, competitionId: f.competition?.id ?? null}));
      latest.snapshotId = snapId;
    } else latest.snapshotId = prev.id;
  } else {
    // Keep the last estimate visible with its original time and state, outside current recommendations.
    const prev = await s.one('SELECT id,created_at,payload FROM live_snapshots WHERE fixture_id=? AND model_version=? ORDER BY created_at DESC LIMIT 1', id, INPLAY_MODEL);
    if (prev) { const p = JSON.parse(prev.payload); latest.previous = {snapshotId: prev.id, createdAt: Number(prev.created_at), input: p.input, markets: p.markets}; }
  }
  await s.putCache(`inplay:${id}`, latest, 6 * 3600000);
  return latest;
}
