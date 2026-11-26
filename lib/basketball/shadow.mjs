// Basketball shadow model: does verified availability (from cited research) improve the baseline bball-elo-1?
// Snapshots only before tip-off; the effect per reported absence is fitted on earlier settled games and scored on later
// ones. Published predictions never change until the documented promotion criteria pass.
const ABSENT = new Set(['injured', 'suspended', 'unavailable']), MIN_TRAIN = 150, MIN_TEST = 150;

export async function recordBasketballSnapshot(service, game, research) {
  const s = service.store, now = s.now(); if (!(game.startsAt > now)) return null;
  const pred = await s.one('SELECT id,created_at,payload FROM basketball_predictions WHERE game_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 1', game.id, now); if (!pred) return null;
  const p = JSON.parse(pred.payload), av = research?.availability ?? [], c = side => av.filter(a => a.team === side && ABSENT.has(a.status)).length, d = side => av.filter(a => a.team === side && a.status === 'doubtful').length;
  const snap = {gameId: game.id, at: now, tipoff: game.startsAt, predictionId: pred.id, pHome: p.winner.home, margin: p.margin.expected, absentDiff: c('home') - c('away'), doubtfulDiff: d('home') - d('away'), startersConfirmed: research?.lineup?.status === 'confirmed'};
  const prev = (await s.cache(`bshadow:${game.id}`))?.data;
  await s.putCache(`bshadow:${game.id}`, {latest: snap, firstConfirmed: prev?.firstConfirmed ?? (snap.startersConfirmed ? snap : null)}, 400 * 864e5);
  return snap;
}

const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x));
export function evaluateBasketballShadow(rows) {
  // rows: [{tipoff, pHome, absentDiff, doubtfulDiff, homeWon}] in any order
  const list = [...rows].sort((a, b) => a.tipoff - b.tipoff), coverage = {games: list.length, withAbsences: list.filter(r => r.absentDiff || r.doubtfulDiff).length};
  if (list.length < MIN_TRAIN + MIN_TEST) return {state: 'collecting', required: MIN_TRAIN + MIN_TEST, coverage, production: 'unchanged'};
  const train = list.slice(0, Math.floor(list.length / 2)), test = list.slice(Math.floor(list.length / 2));
  const adj = (r, b) => sig(logit(Math.min(0.999, Math.max(0.001, r.pHome))) + b[0] * r.absentDiff + b[1] * r.doubtfulDiff);
  const ll = (set, b) => set.reduce((n, r) => n + Math.log(Math.max(1e-12, r.homeWon ? adj(r, b) : 1 - adj(r, b))), 0);
  const b = [0, 0], grid = [0, -0.05, 0.05, -0.1, 0.1, -0.2, -0.3, -0.4];   // ties prefer no effect
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 2; i++) { let best = -Infinity, arg = 0; for (const g of grid) { b[i] = g; const v = ll(train, b); if (v > best) { best = v; arg = g; } } b[i] = arg; }
  const m = f => { let brier = 0, lo = 0, hit = 0; for (const r of test) { const p = f(r); brier += (p - (r.homeWon ? 1 : 0)) ** 2; lo -= Math.log(Math.max(1e-12, r.homeWon ? p : 1 - p)); hit += (p >= 0.5) === Boolean(r.homeWon) ? 1 : 0; } return {n: test.length, brier: brier / test.length, logLoss: lo / test.length, accuracy: hit / test.length}; };
  return {state: 'evaluated', coverage, trainN: train.length, baseline: m(r => r.pHome), availability: {coefficients: {perAbsence: b[0], perDoubtful: b[1]}, ...m(r => adj(r, b))}, production: 'unchanged until promotion criteria pass'};
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
