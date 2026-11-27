// Shadow (intelligence-enhanced) prediction model. Never changes production probabilities.
// Snapshots: features known BEFORE kickoff, stored per fixture with their time (latest pre-kickoff and the first with
// a confirmed lineup). Evaluation: chronological; each variant's effect sizes are fitted on earlier settled matches
// only and scored on later ones, against the unchanged baseline forecast. Promotion needs the criteria in
// docs/models/live-and-special-markets.md (sample, both halves better, calibration); until then: collecting.
const ABSENT = new Set(['injured', 'suspended', 'unavailable']);
const GK = /goalkeeper|keeper|\bgk\b|portero|goleiro/i;
export const VARIANTS = {
  lineup: ['gkAbsentDiff'],
  availability: ['absentDiff', 'doubtfulDiff'],
  tactical: ['tacticalScore'],
  all: ['gkAbsentDiff', 'absentDiff', 'doubtfulDiff', 'tacticalScore', 'restDiff', 'congestionDiff'],
};
const MIN_TRAIN = 150, MIN_TEST = 150;

/** Rest days and matches in the previous 14 days for a team, from verified results recorded before kickoff. */
async function schedule(s, teamId, kickoff) {
  const rows = await s.all("SELECT starts_at FROM fixtures WHERE (home_team_id=? OR away_team_id=?) AND starts_at<? AND starts_at>? AND status IN ('FT','AET','PEN','FINISHED') ORDER BY starts_at DESC LIMIT 10", teamId, teamId, kickoff, kickoff - 30 * 864e5);
  return {rest: rows.length ? Math.min(30, (kickoff - Number(rows[0].starts_at)) / 864e5) : null, last14: rows.filter(r => kickoff - Number(r.starts_at) <= 14 * 864e5).length};
}

/** Availability is KNOWN for a fixture only when both teams are 'reported' (verified items) or 'none_reported' (a
 * verified source says no absences). 'not_found', 'rejected' and unresearched are unknown, never zero absences.
 * Records written before side states existed count as known only when both teams have verified items. */
export const KNOWN_SIDE = new Set(['reported', 'none_reported']);
export function availabilityKnown(research) {
  if (!research) return false;
  if (research.sides) return KNOWN_SIDE.has(research.sides.home) && KNOWN_SIDE.has(research.sides.away);
  const av = research.availability ?? []; return av.some(a => a.team === 'home') && av.some(a => a.team === 'away');
}

export function researchFeatures(research) {
  const av = research?.availability ?? [], known = availabilityKnown(research), c = side => av.filter(a => a.team === side && ABSENT.has(a.status)).length, d = side => av.filter(a => a.team === side && a.status === 'doubtful').length;
  const gk = side => av.some(a => a.team === side && ABSENT.has(a.status) && GK.test(`${a.detail ?? ''} ${a.position ?? ''}`)) ? 1 : 0;
  return {lineupStatus: research?.lineup?.status ?? 'unknown', availabilityKnown: known, sides: research?.sides ?? null,
    absentDiff: known ? c('home') - c('away') : null, doubtfulDiff: known ? d('home') - d('away') : null, gkAbsentDiff: known ? gk('home') - gk('away') : null, researchedAt: research?.verifiedAt ?? null};
}

/** Gemini factor scores (favours home +, away −, scaled by strength 0–3) for tactical factors only. */
export function tacticalScore(factors) {
  const T = new Set(['formation', 'midfield', 'attack', 'defence', 'tactics']), list = (factors ?? []).filter(f => T.has(f.factor));
  if (!list.length) return null;   // no tactical evidence: unknown, not neutral
  return list.reduce((n, f) => n + (f.favours === 'home' ? 1 : f.favours === 'away' ? -1 : 0) * (f.strength ?? 0), 0);
}

export async function recordShadowSnapshot(service, fixture, research, gemini = null) {
  const s = service.store, now = s.now(); if (!(fixture.startsAt > now)) return null;   // pre-kickoff only
  const fc = await s.one("SELECT id,as_of,payload FROM analysis_forecasts WHERE fixture_id=? AND model_version='poisson-temporal-1' AND as_of<kickoff_at AND as_of<=? ORDER BY as_of DESC LIMIT 1", fixture.id, now);
  if (!fc) return null;
  const p = JSON.parse(fc.payload), [h, a] = await Promise.all([schedule(s, fixture.home.id, fixture.startsAt), schedule(s, fixture.away.id, fixture.startsAt)]);
  const prev = (await s.cache(`shadow:${fixture.id}`))?.data;
  const snap = {fixtureId: fixture.id, at: now, kickoff: fixture.startsAt, forecastId: fc.id, forecastAsOf: Number(fc.as_of), baseline: {probabilities: p.probabilities, expectedGoals: p.expectedGoals},
    ...researchFeatures(research ?? prev?.latest?.research ?? null), research: research ? {availability: research.availability, sides: research.sides ?? null, lineup: {status: research.lineup?.status}, verifiedAt: research.verifiedAt} : prev?.latest?.research ?? null,
    tacticalScore: gemini ? tacticalScore(gemini.factors) : prev?.latest?.tacticalScore ?? null,
    restDiff: h.rest != null && a.rest != null ? h.rest - a.rest : null, congestionDiff: h.rest != null && a.rest != null ? h.last14 - a.last14 : null};
  const record = {latest: snap, firstConfirmed: prev?.firstConfirmed ?? (snap.lineupStatus === 'confirmed' ? snap : null), firstAt: prev?.firstAt ?? now};
  await s.putCache(`shadow:${fixture.id}`, record, 400 * 864e5);
  return record;
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
function probs(lh, la) { let H = 0, D = 0, A = 0, O = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = pois(i, lh) * pois(j, la); if (i > j) H += p; else if (i === j) D += p; else A += p; if (i + j > 2.5) O += p; } const t = H + D + A; return {result: [H / t, D / t, A / t], over25: O}; }
const adjust = (row, keys, beta) => { const x = keys.reduce((n, k, i) => n + beta[i] * (row.f[k] ?? 0), 0); return [row.xg[0] * Math.exp(x), row.xg[1] * Math.exp(-x)]; };
const goalLL = (row, l) => Math.log(Math.max(1e-12, pois(row.goals[0], l[0]) * pois(row.goals[1], l[1])));
/** One coordinate-wise grid search per feature on the training rows (log-likelihood of observed goals). */
function fit(train, keys) {
  const beta = keys.map(() => 0), grid = [0, -0.05, 0.05, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3];   // ties prefer no effect
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < keys.length; i++) { let best = -Infinity, arg = 0; for (const g of grid) { beta[i] = g; const ll = train.reduce((n, r) => n + goalLL(r, adjust(r, keys, beta)), 0); if (ll > best) { best = ll; arg = g; } } beta[i] = arg; }
  return beta;
}
function metrics(rows, pick) {
  let brier = 0, ll = 0, hit = 0, ou = 0; const bins = Array.from({length: 10}, () => ({n: 0, p: 0, y: 0}));
  for (const r of rows) { const q = pick(r), o = r.outcome; brier += q.result.reduce((n, p, i) => n + (p - (i === o ? 1 : 0)) ** 2, 0); ll -= Math.log(Math.max(1e-12, q.result[o])); hit += q.result.indexOf(Math.max(...q.result)) === o ? 1 : 0; ou += (q.over25 - (r.goals[0] + r.goals[1] > 2 ? 1 : 0)) ** 2;
    const p = q.result[0], b = bins[Math.min(9, Math.floor(p * 10))]; b.n++; b.p += p; b.y += o === 0 ? 1 : 0; }
  const n = rows.length, ece = bins.reduce((m, b) => m + (b.n ? b.n / n * Math.abs(b.p / b.n - b.y / b.n) : 0), 0);
  return {n, brier: brier / n, logLoss: ll / n, accuracy: hit / n, over25Brier: ou / n, calibrationErrorHome: ece};
}

/** Chronological evaluation of the four variants against the baseline. */
export async function shadowEvaluation(service) {
  const s = service.store, rows = [];
  for (const r of await s.all("SELECT id,payload FROM football_cache WHERE id LIKE 'shadow:%'")) {
    const snap = JSON.parse(r.payload).data ?? JSON.parse(r.payload), f = snap.latest; if (!f?.baseline?.expectedGoals) continue;
    const fx = await s.one('SELECT status,home_score,away_score FROM fixtures WHERE id=?', f.fixtureId);
    if (!fx || !['FT', 'FINISHED'].includes(fx.status) || !Number.isInteger(fx.home_score) || !Number.isInteger(fx.away_score)) continue;
    rows.push({kickoff: f.kickoff, xg: f.baseline.expectedGoals, base: f.baseline.probabilities, f, goals: [fx.home_score, fx.away_score], outcome: fx.home_score > fx.away_score ? 0 : fx.home_score === fx.away_score ? 1 : 2, confirmed: f.lineupStatus === 'confirmed'});
  }
  rows.sort((a, b) => a.kickoff - b.kickoff);
  const coverage = {settledWithSnapshot: rows.length, withConfirmedLineup: rows.filter(r => r.confirmed).length, availabilityKnown: rows.filter(r => r.f.absentDiff != null).length, withAbsences: rows.filter(r => r.f.absentDiff || r.f.doubtfulDiff).length, withTactical: rows.filter(r => r.f.tacticalScore != null).length};
  if (rows.length < MIN_TRAIN + MIN_TEST) return {state: 'collecting', required: MIN_TRAIN + MIN_TEST, coverage, production: 'unchanged',
    note: 'Effect sizes are fitted only on earlier settled matches and scored on later ones; no variant affects published probabilities.'};
  const train = rows.slice(0, Math.floor(rows.length / 2)), test = rows.slice(Math.floor(rows.length / 2));
  const baseline = metrics(test, r => ({result: r.base, over25: probs(r.xg[0], r.xg[1]).over25}));
  const variants = Object.fromEntries(Object.entries(VARIANTS).map(([name, keys]) => { const beta = fit(train, keys); return [name, {beta: Object.fromEntries(keys.map((k, i) => [k, beta[i]])), test: metrics(test, r => probs(...adjust(r, keys, beta)))}]; }));
  return {state: 'evaluated', coverage, trainN: train.length, baseline, variants, production: 'unchanged until promotion criteria pass'};
}
