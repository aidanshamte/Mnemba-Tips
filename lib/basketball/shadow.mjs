// Basketball shadow model: do verified availability (cited research) and Gemini's evidence-bound factors improve the
// published prediction? Snapshots only before tip-off; effects are fitted on earlier settled games and scored on later
// ones. UNKNOWN IS NOT ZERO: a feature is null unless both teams' availability is known (reported, or explicitly
// none reported with a verified source); null features leave the baseline unchanged and carry no weight in fitting.
// Published predictions never change until the documented promotion criteria pass.
import {availabilityKnown} from '../football/shadow-model.mjs';
const ABSENT = new Set(['injured', 'suspended', 'unavailable']), MIN_TRAIN = 150, MIN_TEST = 150;
export const BASKETBALL_VARIANTS = {availability: ['absentDiff', 'doubtfulDiff'], gemini: ['geminiScore'], all: ['absentDiff', 'doubtfulDiff', 'geminiScore']};

/** Gemini factor score: favours home +, away -, scaled by strength 0-3; null without factors. */
export const geminiScore = factors => Array.isArray(factors) && factors.length ? factors.reduce((n, f) => n + (f.favours === 'home' ? 1 : f.favours === 'away' ? -1 : 0) * (f.strength ?? 0), 0) : null;

export function basketballFeatures(research) {
  const av = research?.availability ?? [], known = availabilityKnown(research);
  const c = side => av.filter(a => a.team === side && ABSENT.has(a.status)).length, d = side => av.filter(a => a.team === side && a.status === 'doubtful').length;
  return {availabilityKnown: known, absentDiff: known ? c('home') - c('away') : null, doubtfulDiff: known ? d('home') - d('away') : null, startersConfirmed: research?.lineup?.status === 'confirmed'};
}

export async function recordBasketballSnapshot(service, game, research, gemini = null) {
  const s = service.store, now = s.now(); if (!(game.startsAt > now)) return null;
  const pred = await s.one('SELECT id,created_at,payload FROM basketball_predictions WHERE game_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 1', game.id, now); if (!pred) return null;
  const prev = (await s.cache(`bshadow:${game.id}`))?.data, p = JSON.parse(pred.payload);
  const snap = {gameId: game.id, at: now, tipoff: game.startsAt, predictionId: pred.id, model: p.model, pHome: p.winner.home, margin: p.margin.expected,
    ...basketballFeatures(research ?? prev?.latest?.research ?? null), geminiScore: gemini ? geminiScore(gemini.factors) : prev?.latest?.geminiScore ?? null,
    research: research ? {availability: research.availability, sides: research.sides ?? null, lineup: {status: research.lineup?.status}} : prev?.latest?.research ?? null};
  await s.putCache(`bshadow:${game.id}`, {latest: snap, firstConfirmed: prev?.firstConfirmed ?? (snap.startersConfirmed ? snap : null)}, 400 * 864e5);
  return snap;
}

const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x));
const adj = (r, keys, b) => sig(logit(Math.min(0.999, Math.max(0.001, r.pHome))) + keys.reduce((n, k, i) => n + b[i] * (r[k] ?? 0), 0));
const ll = (set, keys, b) => set.reduce((n, r) => n + Math.log(Math.max(1e-12, r.homeWon ? adj(r, keys, b) : 1 - adj(r, keys, b))), 0);
function fit(train, keys) {
  const b = keys.map(() => 0), grid = [0, -0.05, 0.05, -0.1, 0.1, -0.2, 0.2, -0.3, -0.4];   // ties prefer no effect
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < keys.length; i++) { let best = -Infinity, arg = 0; for (const g of grid) { b[i] = g; const v = ll(train, keys, b); if (v > best) { best = v; arg = g; } } b[i] = arg; }
  return b;
}
const metrics = (test, f) => { let brier = 0, lo = 0, hit = 0; for (const r of test) { const p = f(r); brier += (p - (r.homeWon ? 1 : 0)) ** 2; lo -= Math.log(Math.max(1e-12, r.homeWon ? p : 1 - p)); hit += (p >= 0.5) === Boolean(r.homeWon) ? 1 : 0; } return {n: test.length, brier: brier / test.length, logLoss: lo / test.length, accuracy: hit / test.length}; };

export function evaluateBasketballShadow(rows) {
  // rows: [{tipoff, pHome, absentDiff, doubtfulDiff, geminiScore, homeWon}] in any order
  const list = [...rows].sort((a, b) => a.tipoff - b.tipoff);
  const coverage = {games: list.length, availabilityKnown: list.filter(r => r.absentDiff != null).length, withAbsences: list.filter(r => r.absentDiff || r.doubtfulDiff).length, withGemini: list.filter(r => r.geminiScore != null).length};
  if (list.length < MIN_TRAIN + MIN_TEST) return {state: 'collecting', required: MIN_TRAIN + MIN_TEST, coverage, production: 'unchanged'};
  const train = list.slice(0, Math.floor(list.length / 2)), test = list.slice(Math.floor(list.length / 2));
  const variants = Object.fromEntries(Object.entries(BASKETBALL_VARIANTS).map(([name, keys]) => { const b = fit(train, keys); return [name, {coefficients: Object.fromEntries(keys.map((k, i) => [k, b[i]])), ...metrics(test, r => adj(r, keys, b))}]; }));
  return {state: 'evaluated', coverage, trainN: train.length, baseline: metrics(test, r => r.pHome), variants, availability: variants.availability, production: 'unchanged until promotion criteria pass'};
}

export async function basketballShadowStatus(store) {
  const rows = [];
  for (const r of await store.all("SELECT payload FROM football_cache WHERE id LIKE 'bshadow:%'")) {
    const snap = (JSON.parse(r.payload).data ?? JSON.parse(r.payload)).latest; if (!snap) continue;
    const g = await store.one('SELECT status,home_score,away_score FROM basketball_games WHERE id=?', snap.gameId);
    if (g?.status === 'FT' && Number.isInteger(g.home_score)) rows.push({...snap, homeWon: g.home_score > g.away_score});
  }
  return evaluateBasketballShadow(rows);
}
