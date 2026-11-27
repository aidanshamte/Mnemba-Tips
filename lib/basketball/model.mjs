// Basketball model `bball-elo-1` (not the football model). Inputs are only what the free data provides: final scores,
// quarter scores (2023+), dates and venues. Possession-based metrics (pace, offensive/defensive rating, eFG%, TS%,
// TOV%, rebound%, FT rate) need box scores, which are not on the free plan, so they are not computed or invented.
// - Win probability: margin-of-victory Elo with home-court advantage and season-to-season regression to the mean.
// - Margin: fitted linear scale of the Elo gap (training season only); totals and team totals from rolling points for
//   and against; first-half totals from quarter scores. Uncertainty ranges from training residuals.
// - Back-to-back is a shadow feature: fitted on the training season and reported, not used in published numbers.
// bball-elo-2 (coherent): one predictive distribution. Margin M ~ Normal(mu, marginSd) and total T ~ Normal(tau,
// totalSd); team totals are (tau +/- mu) / 2; P(home win) = P(M > 0); the half-time margin is a fitted share of mu.
// Two coherent ways to set mu and P(win): 'margin' (P = Phi(mu/sd), mu from the Elo gap) or 'probability' (P from
// the calibrated Elo logistic, mu = sd * Phi^-1(P)). 'margin' is used only if it beats the logistic on BOTH Brier and
// log loss out of sample; otherwise 'probability', which leaves win probabilities identical to bball-elo-1.
export const MODEL = 'bball-elo-2';
export const LEGACY_MODEL = 'bball-elo-1';
const K = 20, HCA = 100, MEAN = 1505, CARRY = 0.75, ALPHA = 0.12;

const exp = (d) => 1 / (1 + Math.pow(10, -d / 400));
const ema = (old, v) => old == null ? v : old + ALPHA * (v - old);

/** Replay finished games chronologically; `onGame(state, game)` is called BEFORE each game updates the state. */
export function replay(games, onGame) {
  const st = {elo: new Map(), off: new Map(), def: new Map(), h1off: new Map(), h1def: new Map(), last: new Map(), season: null, leaguePts: null, leagueH1: null};
  for (const g of games) {
    if (st.season !== g.season) { for (const [k, v] of st.elo) st.elo.set(k, CARRY * v + (1 - CARRY) * MEAN); st.season = g.season; }
    if (onGame) onGame(st, g);
    if (g.status !== 'FT' || !Number.isInteger(g.homeScore) || !Number.isInteger(g.awayScore)) continue;
    const h = g.home.id, a = g.away.id, eh = st.elo.get(h) ?? MEAN, ea = st.elo.get(a) ?? MEAN, p = exp(eh - ea + HCA), m = g.homeScore - g.awayScore;
    const winnerGap = (m > 0 ? 1 : -1) * (eh - ea + HCA), mult = Math.pow(Math.abs(m) + 3, 0.8) / (7.5 + 0.006 * winnerGap), d = K * mult * ((m > 0 ? 1 : 0) - p);
    st.elo.set(h, eh + d); st.elo.set(a, ea - d);
    st.off.set(h, ema(st.off.get(h), g.homeScore)); st.def.set(h, ema(st.def.get(h), g.awayScore));
    st.off.set(a, ema(st.off.get(a), g.awayScore)); st.def.set(a, ema(st.def.get(a), g.homeScore));
    st.leaguePts = ema(st.leaguePts, (g.homeScore + g.awayScore) / 2);
    const hq = g.quarters?.home ?? [], aq = g.quarters?.away ?? [];
    if (Number.isInteger(hq[0]) && Number.isInteger(hq[1]) && Number.isInteger(aq[0]) && Number.isInteger(aq[1])) {
      const h1 = hq[0] + hq[1], a1 = aq[0] + aq[1];
      st.h1off.set(h, ema(st.h1off.get(h), h1)); st.h1def.set(h, ema(st.h1def.get(h), a1)); st.h1off.set(a, ema(st.h1off.get(a), a1)); st.h1def.set(a, ema(st.h1def.get(a), h1));
      st.leagueH1 = ema(st.leagueH1, (h1 + a1) / 2);
    }
    st.last.set(h, g.startsAt); st.last.set(a, g.startsAt);
  }
  return st;
}

/** Pre-game features from the state (no information from the game itself). */
export function features(st, g) {
  const h = g.home.id, a = g.away.id, eloGap = (st.elo.get(h) ?? MEAN) - (st.elo.get(a) ?? MEAN) + HCA;
  const b2b = id => st.last.has(id) && g.startsAt - st.last.get(id) < 36 * 3600000 ? 1 : 0;
  const pts = (off, def, side, other, lg) => off.has(side) && def.has(other) ? (off.get(side) + def.get(other)) / 2 : lg;
  return {eloGap, pHome: exp(eloGap), homePts: pts(st.off, st.def, h, a, st.leaguePts), awayPts: pts(st.off, st.def, a, h, st.leaguePts),
    homeH1: pts(st.h1off, st.h1def, h, a, st.leagueH1), awayH1: pts(st.h1off, st.h1def, a, h, st.leagueH1), b2bHome: b2b(h), b2bAway: b2b(a),
    history: Math.min(...[h, a].map(id => st.off.has(id) ? 1 : 0))};
}

/** Fit margin scale and residual spreads on training rows: rows = [{f, game}]. */
export function fitCalibration(rows) {
  const fin = rows.filter(r => Number.isInteger(r.game.homeScore) && r.f.homePts != null);
  if (fin.length < 200) return null;
  const sxy = fin.reduce((n, r) => n + r.f.eloGap * (r.game.homeScore - r.game.awayScore), 0), sxx = fin.reduce((n, r) => n + r.f.eloGap ** 2, 0), scale = sxy / sxx;
  const sd = list => Math.sqrt(list.reduce((n, x) => n + x * x, 0) / Math.max(1, list.length - 1));
  const h1 = fin.filter(r => r.f.homeH1 != null && Number.isInteger(r.game.quarters?.home?.[1]));
  // Back-to-back (shadow): Elo points per back-to-back difference, by grid search on training log-likelihood.
  let b2b = 0, best = -Infinity;
  for (const c of [-80, -60, -40, -20, 0, 20]) { const ll = fin.reduce((n, r) => { const p = exp(r.f.eloGap + c * (r.f.b2bHome - r.f.b2bAway)); return n + Math.log(r.game.homeScore > r.game.awayScore ? p : 1 - p); }, 0); if (ll > best) { best = ll; b2b = c; } }
  // Coherent extras: team totals derived from (tau +/- mu)/2, half-time margin as a share of mu.
  const mu = r => scale * r.f.eloGap, h1m = h1.map(r => [r.game.quarters.home[0] + r.game.quarters.home[1] - r.game.quarters.away[0] - r.game.quarters.away[1], mu(r)]);
  const h1Share = h1m.length >= 100 ? h1m.reduce((n, [y, x]) => n + x * y, 0) / Math.max(1e-9, h1m.reduce((n, [, x]) => n + x * x, 0)) : null;
  const coherent = {teamSd: sd(fin.flatMap(r => [r.game.homeScore - (r.f.homePts + r.f.awayPts + mu(r)) / 2, r.game.awayScore - (r.f.homePts + r.f.awayPts - mu(r)) / 2])),
    h1Share, h1MarginSd: h1Share != null ? sd(h1m.map(([y, x]) => y - h1Share * x)) : null};
  return {coherent, n: fin.length, scale, marginSd: sd(fin.map(r => r.game.homeScore - r.game.awayScore - scale * r.f.eloGap)), totalSd: sd(fin.map(r => r.game.homeScore + r.game.awayScore - r.f.homePts - r.f.awayPts)),
    teamSd: sd(fin.flatMap(r => [r.game.homeScore - r.f.homePts, r.game.awayScore - r.f.awayPts])),
    h1Sd: h1.length >= 100 ? sd(h1.map(r => r.game.quarters.home[0] + r.game.quarters.home[1] + r.game.quarters.away[0] + r.game.quarters.away[1] - r.f.homeH1 - r.f.awayH1)) : null, b2bElo: b2b};
}

const normCdf = z => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
/** Inverse standard normal (Acklam), |error| < 1.2e-9. */
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p)), lo = 0.02425;
  if (q < lo) { const t = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1); }
  if (q > 1 - lo) return -normInv(1 - q);
  const t = q - 0.5, r = t * t; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/** Coherent margin and win probability for a mode ('margin' | 'probability'). */
export function coherentCore(f, cal, mode) {
  if (mode === 'margin') { const mu = cal.scale * f.eloGap; return {mu, p: normCdf(mu / cal.marginSd)}; }
  return {p: f.pHome, mu: cal.marginSd * normInv(f.pHome)};
}

/** bball-elo-2: every number comes from one distribution (see header). */
export function predict(f, cal, mode = 'probability') {
  if (!cal?.coherent || !f.history || f.homePts == null) return {state: 'unavailable', reason: 'Not enough recorded games for both teams'};
  const {mu, p} = coherentCore(f, cal, mode), tau = f.homePts + f.awayPts, k = cal.coherent;
  const range = (m, sd) => [Math.round(m - sd), Math.round(m + sd)];
  const h1 = f.homeH1 != null && f.awayH1 != null && k.h1Share != null && k.h1MarginSd && cal.h1Sd ? (() => { const t1 = f.homeH1 + f.awayH1, m1 = k.h1Share * mu;
    return {home: (t1 + m1) / 2, away: (t1 - m1) / 2, total: {expected: t1, range: range(t1, cal.h1Sd)}, margin: {expected: m1, range: range(m1, k.h1MarginSd)}, homeLeads: normCdf(m1 / k.h1MarginSd)}; })() : null;
  return {state: 'ok', model: MODEL, mode, winner: {home: p, away: 1 - p}, margin: {expected: mu, range: range(mu, cal.marginSd)},
    total: {expected: tau, range: range(tau, cal.totalSd)}, teamTotals: {home: {expected: (tau + mu) / 2, range: range((tau + mu) / 2, k.teamSd)}, away: {expected: (tau - mu) / 2, range: range((tau - mu) / 2, k.teamSd)}},
    firstHalf: h1, context: {backToBack: {home: Boolean(f.b2bHome), away: Boolean(f.b2bAway)}},
    note: 'One predictive distribution: team points are (total ± margin) / 2 and the win probability is the chance the margin is positive. Ranges are ±1 standard deviation of past errors. Back-to-back is context only.'};
}

export function predictLegacy(f, cal) {
  if (!cal || !f.history || f.homePts == null) return {state: 'unavailable', reason: 'Not enough recorded games for both teams'};
  const margin = cal.scale * f.eloGap, total = f.homePts + f.awayPts;
  const range = (m, sd) => [Math.round(m - sd), Math.round(m + sd)];
  return {state: 'ok', model: LEGACY_MODEL, winner: {home: f.pHome, away: 1 - f.pHome}, margin: {expected: margin, range: range(margin, cal.marginSd)},
    total: {expected: total, range: range(total, cal.totalSd)}, teamTotals: {home: {expected: f.homePts, range: range(f.homePts, cal.teamSd)}, away: {expected: f.awayPts, range: range(f.awayPts, cal.teamSd)}},
    firstHalf: f.homeH1 != null && f.awayH1 != null && cal.h1Sd ? {home: f.homeH1, away: f.awayH1, total: {expected: f.homeH1 + f.awayH1, range: range(f.homeH1 + f.awayH1, cal.h1Sd)}, homeLeads: normCdf((f.homeH1 - f.awayH1) / (cal.h1Sd / 1.4))} : null,
    context: {backToBack: {home: Boolean(f.b2bHome), away: Boolean(f.b2bAway)}}, note: 'Ranges are ±1 standard deviation of past errors. Back-to-back is shown as context; it does not change these numbers.'};
}

/** Chronological evaluation: calibration fitted on the first season, every later game predicted before it is played. */
export function evaluate(games) {
  const seasons = [...new Set(games.map(g => g.season))].sort();
  if (seasons.length < 2) return {state: 'collecting', reason: 'At least two seasons of results are needed', seasons};
  const train = [], test = [];
  replay(games, (st, g) => { if (g.status !== 'FT' || !Number.isInteger(g.homeScore)) return; (g.season === seasons[0] ? train : test).push({f: features(st, g), game: g}); });
  const cal = fitCalibration(train); if (!cal) return {state: 'collecting', reason: 'Too few training games'};
  const rows = test.filter(r => r.f.history);
  const m = (list, pFor) => { let brier = 0, ll = 0, hit = 0; const bins = Array.from({length: 10}, () => ({n: 0, p: 0, y: 0}));
    for (const r of list) { const p = pFor(r), y = r.game.homeScore > r.game.awayScore ? 1 : 0; brier += (p - y) ** 2; ll -= Math.log(Math.max(1e-12, y ? p : 1 - p)); hit += (p >= 0.5) === (y === 1) ? 1 : 0; const b = bins[Math.min(9, Math.floor(p * 10))]; b.n++; b.p += p; b.y += y; }
    const n = list.length; if (!n) return {n: 0}; return {n, accuracy: hit / n, brier: brier / n, logLoss: ll / n, calibration: bins.filter(b => b.n >= 30).map(b => ({predicted: +(b.p / b.n).toFixed(3), observed: +(b.y / b.n).toFixed(3), n: b.n}))}; };
  const mae = (list, fn) => list.length ? list.reduce((n, r) => n + Math.abs(fn(r)), 0) / list.length : null;
  const base = m(rows, r => r.f.pHome), marginMode = m(rows, r => coherentCore(r.f, cal, 'margin').p), shadow = m(rows, r => exp(r.f.eloGap + cal.b2bElo * (r.f.b2bHome - r.f.b2bAway)));
  const h1rows = rows.filter(r => r.f.homeH1 != null && Number.isInteger(r.game.quarters?.home?.[1]));
  return {state: 'evaluated', model: MODEL, trainSeason: seasons[0], testSeasons: seasons.slice(1), calibrationFit: cal,
    winner: base, marginMae: mae(rows, r => r.game.homeScore - r.game.awayScore - cal.scale * r.f.eloGap), totalMae: mae(rows, r => r.game.homeScore + r.game.awayScore - r.f.homePts - r.f.awayPts),
    teamTotalMae: mae(rows, r => r.game.homeScore - r.f.homePts), firstHalfTotalMae: mae(h1rows, r => r.game.quarters.home[0] + r.game.quarters.home[1] + r.game.quarters.away[0] + r.game.quarters.away[1] - r.f.homeH1 - r.f.awayH1),
    coherent: (() => { const k = cal.coherent, err = (list, fn) => mae(list, fn);
      const choice = marginMode.brier < base.brier && marginMode.logLoss < base.logLoss ? 'margin' : 'probability';
      const h1l = h1rows.filter(() => k.h1Share != null), leads = mode => h1l.length ? h1l.reduce((n, r) => { const m1 = k.h1Share * coherentCore(r.f, cal, mode).mu, y = r.game.quarters.home[0] + r.game.quarters.home[1] > r.game.quarters.away[0] + r.game.quarters.away[1] ? 1 : 0; return n + (normCdf(m1 / k.h1MarginSd) - y) ** 2; }, 0) / h1l.length : null;
      const legacyLeads = h1l.length ? h1l.reduce((n, r) => { const y = r.game.quarters.home[0] + r.game.quarters.home[1] > r.game.quarters.away[0] + r.game.quarters.away[1] ? 1 : 0; return n + (normCdf((r.f.homeH1 - r.f.awayH1) / (cal.h1Sd / 1.4)) - y) ** 2; }, 0) / h1l.length : null;
      return {choice, rule: "'margin' only if it beats the logistic on both Brier and log loss", winnerMarginMode: marginMode,
        marginMae: {margin: err(rows, r => r.game.homeScore - r.game.awayScore - coherentCore(r.f, cal, 'margin').mu), probability: err(rows, r => r.game.homeScore - r.game.awayScore - coherentCore(r.f, cal, 'probability').mu)},
        teamTotalMae: {legacy: mae(rows, r => r.game.homeScore - r.f.homePts), coherent: mae(rows, r => r.game.homeScore - (r.f.homePts + r.f.awayPts + coherentCore(r.f, cal, choice).mu) / 2)},
        halfTimeLeadBrier: {legacy: legacyLeads, coherent: leads(choice)}}; })(),
    bySeason: Object.fromEntries(seasons.slice(1).map(sn => [sn, m(rows.filter(r => r.game.season === sn), r => r.f.pHome)])),
    postseason: m(rows.filter(r => r.game.postseason), r => r.f.pHome), shadowBackToBack: {elo: cal.b2bElo, ...shadow, promoted: false}};
}
