// Corners and cards: their own count models, fitted only from recorded counts before the forecast cutoff (never derived
// from expected goals or result probabilities). Provisional until a locked evaluation qualifies them; excluded from Top picks.
// Model: team rate for and against (last 20 matches with counts, shrunk toward the pool mean with 5 pseudo-matches),
// multiplicative pairing, negative-binomial counts with dispersion estimated from the pool's match totals.
// Cards = yellow + red cards as the source counts them (a second yellow is whatever the source reports; booking points
// are not used). Settlement uses the source's full-match counts; a missing count stays pending, never a loss.
export const SPECIAL_MODEL = 'special-nb-1';
const MIN_TEAM = 10, WINDOW = 20, PRIOR = 5, POOL = 400;
const FAMILIES = {
  corners: {get: (g, side) => g.corners?.[side], totals: [8.5, 9.5, 10.5, 11.5], team: [3.5, 4.5, 5.5], label: 'Corners'},
  cards: {get: (g, side) => { const c = g.cards?.[side]; return c && Number.isFinite(c.yellow) && Number.isFinite(c.red) ? c.yellow + c.red : undefined; }, totals: [2.5, 3.5, 4.5, 5.5], team: [1.5, 2.5], label: 'Cards',
    definition: 'Yellow plus red cards as counted by the source; booking points are not used.'},
};
const ok = v => Number.isInteger(v) && v >= 0;

/** Negative-binomial cumulative probability of more than `line` events (mean mu, size r; r = Infinity is Poisson). */
export function overProbability(mu, r, line) {
  const max = Math.floor(line); let pk, cdf = 0;
  if (!Number.isFinite(r)) { pk = Math.exp(-mu); for (let k = 0; k <= max; k++) { if (k) pk *= mu / k; cdf += pk; } }
  else { const p = r / (r + mu); pk = Math.pow(p, r); for (let k = 0; k <= max; k++) { if (k) pk *= (k - 1 + r) / k * (1 - p); cdf += pk; } }
  return Math.min(1, Math.max(0, 1 - cdf));
}

function teamRates(rows, teamId, fam) {
  const games = rows.filter(g => g.home.id === teamId || g.away.id === teamId).slice(-WINDOW);
  let f = 0, a = 0;
  for (const g of games) { const side = g.home.id === teamId ? 'home' : 'away', other = side === 'home' ? 'away' : 'home'; f += fam.get(g, side); a += fam.get(g, other); }
  return {n: games.length, for: f, against: a};
}

export function specialMarkets(f, history, cutoff) {
  const out = {model: SPECIAL_MODEL, provisional: true};
  for (const [key, fam] of Object.entries(FAMILIES)) {
    const rows = history.filter(g => g.startsAt < cutoff && ['FT', 'FINISHED'].includes(g.status) && ok(fam.get(g, 'home')) && ok(fam.get(g, 'away'))).sort((a, b) => a.startsAt - b.startsAt);
    const h = teamRates(rows, f.home.id, fam), a = teamRates(rows, f.away.id, fam);
    if (h.n < MIN_TEAM || a.n < MIN_TEAM) { out[key] = {withheld: `${fam.label}: ${h.n < MIN_TEAM ? f.home.name : f.away.name} has ${Math.min(h.n, a.n)} recorded matches with ${key} counts; ${MIN_TEAM} are needed.`}; continue; }
    const pool = rows.slice(-POOL), totals = pool.map(g => fam.get(g, 'home') + fam.get(g, 'away'));
    const mean = totals.reduce((n, x) => n + x, 0) / totals.length, perTeam = mean / 2;
    const variance = totals.reduce((n, x) => n + (x - mean) ** 2, 0) / Math.max(1, totals.length - 1);
    const r = variance > mean ? mean * mean / (variance - mean) : Infinity;
    const sh = (sum, n) => (sum + PRIOR * perTeam) / (n + PRIOR);
    const eh = sh(h.for, h.n) * sh(a.against, a.n) / perTeam, ea = sh(a.for, a.n) * sh(h.against, h.n) / perTeam, total = eh + ea;
    out[key] = {expected: [eh, ea], dispersion: Number.isFinite(r) ? r : null, sample: {home: h.n, away: a.n, pool: pool.length},
      totals: fam.totals.map(line => ({line, over: overProbability(total, r, line)})),
      home: fam.team.map(line => ({line, over: overProbability(eh, r / 2, line)})), away: fam.team.map(line => ({line, over: overProbability(ea, r / 2, line)})),
      ...(fam.definition ? {definition: fam.definition} : {})};
  }
  return out;
}

/** Settle stored special markets against the source's full-match counts. */
export function settleSpecial(special, fixture) {
  if (!special) return null;
  const out = {};
  for (const [key, fam] of Object.entries(FAMILIES)) {
    const m = special[key]; if (!m || m.withheld) continue;
    const ch = fam.get(fixture, 'home'), ca = fam.get(fixture, 'away');
    if (!ok(ch) || !ok(ca)) { out[key] = {state: 'pending', reason: `${fam.label} count unavailable from the result source`}; continue; }
    const res = (list, n) => list.map(x => ({line: x.line, over: x.over, outcome: n > x.line ? 'over' : 'under'}));
    out[key] = {state: 'settled', counts: {home: ch, away: ca}, totals: res(m.totals, ch + ca), home: res(m.home, ch), away: res(m.away, ca)};
  }
  return Object.keys(out).length ? out : null;
}
