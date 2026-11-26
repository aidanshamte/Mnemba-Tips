// Basketball model `bball-elo-1` (not the football model). Inputs are only what the free data provides: final scores,
// quarter scores (2023+), dates and venues. Possession-based metrics (pace, offensive/defensive rating, eFG%, TS%,
// TOV%, rebound%, FT rate) need box scores, which are not on the free plan, so they are not computed or invented.
// - Win probability: margin-of-victory Elo with home-court advantage and season-to-season regression to the mean.
// - Margin: fitted linear scale of the Elo gap (training season only); totals and team totals from rolling points for
//   and against; first-half totals from quarter scores. Uncertainty ranges from training residuals.
// - Back-to-back is a shadow feature: fitted on the training season and reported, not used in published numbers.
export const MODEL = 'bball-elo-1';
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
  return {n: fin.length, scale, marginSd: sd(fin.map(r => r.game.homeScore - r.game.awayScore - scale * r.f.eloGap)), totalSd: sd(fin.map(r => r.game.homeScore + r.game.awayScore - r.f.homePts - r.f.awayPts)),
    teamSd: sd(fin.flatMap(r => [r.game.homeScore - r.f.homePts, r.game.awayScore - r.f.awayPts])),
    h1Sd: h1.length >= 100 ? sd(h1.map(r => r.game.quarters.home[0] + r.game.quarters.home[1] + r.game.quarters.away[0] + r.game.quarters.away[1] - r.f.homeH1 - r.f.awayH1)) : null, b2bElo: b2b};
}

const normCdf = z => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
export function predict(f, cal) {
  if (!cal || !f.history || f.homePts == null) return {state: 'unavailable', reason: 'Not enough recorded games for both teams'};
  const margin = cal.scale * f.eloGap, total = f.homePts + f.awayPts;
  const range = (m, sd) => [Math.round(m - sd), Math.round(m + sd)];
  return {state: 'ok', model: MODEL, winner: {home: f.pHome, away: 1 - f.pHome}, margin: {expected: margin, range: range(margin, cal.marginSd)},
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
  const base = m(rows, r => r.f.pHome), shadow = m(rows, r => exp(r.f.eloGap + cal.b2bElo * (r.f.b2bHome - r.f.b2bAway)));
  const h1rows = rows.filter(r => r.f.homeH1 != null && Number.isInteger(r.game.quarters?.home?.[1]));
  return {state: 'evaluated', model: MODEL, trainSeason: seasons[0], testSeasons: seasons.slice(1), calibrationFit: cal,
    winner: base, marginMae: mae(rows, r => r.game.homeScore - r.game.awayScore - cal.scale * r.f.eloGap), totalMae: mae(rows, r => r.game.homeScore + r.game.awayScore - r.f.homePts - r.f.awayPts),
    teamTotalMae: mae(rows, r => r.game.homeScore - r.f.homePts), firstHalfTotalMae: mae(h1rows, r => r.game.quarters.home[0] + r.game.quarters.home[1] + r.game.quarters.away[0] + r.game.quarters.away[1] - r.f.homeH1 - r.f.awayH1),
    bySeason: Object.fromEntries(seasons.slice(1).map(sn => [sn, m(rows.filter(r => r.game.season === sn), r => r.f.pHome)])),
    postseason: m(rows.filter(r => r.game.postseason), r => r.f.pHome), shadowBackToBack: {elo: cal.b2bElo, ...shadow, promoted: false}};
}
