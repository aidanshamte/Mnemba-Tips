// Daily and match reports from immutable forecasts, grade audits and live snapshots.
// Headline policy (fixed): per canonical match, the latest forecast of the production model made before kickoff with
// evidence known by then. Missing outcomes stay pending; voids and withheld results are listed, never counted as losses.
// Reporting timezone: the requested IANA zone (default UTC); a correction appears on the day it is recorded.
import {matchdayRange} from './matchday.mjs';
import {livePerformance, bandOf} from './live-grading.mjs';

const PRIMARY = 'poisson-temporal-1';
const csvCell = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

export async function dailyReport(service, params) {
  const s = service.store, date = params.get('date') ?? new Date(s.now()).toISOString().slice(0, 10);
  const range = matchdayRange(new URLSearchParams({day: 'date', from: date, timezone: params.get('timezone') ?? 'UTC'}), s.now());
  const forecasts = await s.all('SELECT p.id,p.fixture_id,p.as_of,p.kickoff_at,p.max_known_at,p.payload,i.canonical_id,f.payload fx FROM analysis_forecasts p JOIN fixtures f ON f.id=p.fixture_id LEFT JOIN fixture_identities i ON i.fixture_id=p.fixture_id WHERE p.model_version=? AND p.kickoff_at>=? AND p.kickoff_at<? AND p.as_of<p.kickoff_at AND p.max_known_at<=p.as_of ORDER BY p.as_of', PRIMARY, range.start, range.end);
  const chosen = new Map(); for (const r of forecasts) chosen.set(r.canonical_id ?? r.fixture_id, r);
  const ids = [...chosen.values()].map(r => r.id), audit = new Map();
  for (let i = 0; i < ids.length; i += 300) { const c = ids.slice(i, i + 300); for (const a of await s.all(`SELECT forecast_id,state,payload,recorded_at FROM analysis_grade_audit WHERE forecast_id IN (${c.map(() => '?').join(',')}) ORDER BY recorded_at`, ...c)) audit.set(a.forecast_id, a); }
  const rows = [], byCompetition = {}, totals = {won: 0, lost: 0, push: 0, void: 0, withheld: 0, pending: 0, noPick: 0};
  const special = {corners: {n: 0, brier: 0}, cards: {n: 0, brier: 0}};
  for (const r of chosen.values()) {
    const p = JSON.parse(r.payload), f = JSON.parse(r.fx), a = audit.get(r.id), g = a ? JSON.parse(a.payload) : null;
    const state = a?.state ?? 'pending';
    let result = state === 'graded' ? (g.resultCorrect === true ? 'won' : g.resultCorrect === false ? 'lost' : 'noPick') : state === 'void' ? 'void' : state === 'withheld' ? 'withheld' : 'pending';
    totals[result]++;
    const comp = f.competition?.name ?? 'Unknown'; byCompetition[comp] ??= {won: 0, lost: 0, pending: 0, other: 0}; byCompetition[comp][['won', 'lost', 'pending'].includes(result) ? result : 'other']++;
    for (const fam of ['corners', 'cards']) { const t = g?.special?.[fam]; if (t?.state === 'settled') for (const x of t.totals) { special[fam].n++; special[fam].brier += (x.over - (x.outcome === 'over' ? 1 : 0)) ** 2; } }
    rows.push({kickoff: new Date(r.kickoff_at).toISOString(), competition: comp, home: f.home?.name, away: f.away?.name, forecastAt: new Date(Number(r.as_of)).toISOString(), model: PRIMARY,
      home_p: p.probabilities?.[0], draw_p: p.probabilities?.[1], away_p: p.probabilities?.[2], final: g?.homeScore != null ? `${g.homeScore}-${g.awayScore}` : '', state, result, gradedAt: a ? new Date(Number(a.recorded_at)).toISOString() : ''});
  }
  const fixtures = Number((await s.one("SELECT COUNT(*) n FROM fixtures WHERE starts_at>=? AND starts_at<? AND status NOT IN ('PST','CANC')", range.start, range.end)).n);
  const settledToday = Number((await s.one("SELECT COUNT(DISTINCT forecast_id) n FROM analysis_grade_audit WHERE state='graded' AND recorded_at>=? AND recorded_at<?", range.start, range.end)).n);
  const liveRows = (await s.all("SELECT l.fixture_id,l.canonical_id,l.minute,l.payload,g.payload grade,g.state FROM live_snapshots l LEFT JOIN live_grades g ON g.snapshot_id=l.id WHERE l.created_at>=? AND l.created_at<?", range.start, range.end))
    .map(r => ({fixtureId: r.fixture_id, canonical: r.canonical_id, band: bandOf(r.minute, JSON.parse(r.payload).input?.status), state: r.state ?? 'pending', grade: r.grade ? JSON.parse(r.grade) : null}));
  return {date, timezone: range.zone, range: {start: range.start, end: range.end}, policy: 'Latest pre-kickoff forecast of the production model per match. Pending, void and withheld are not losses.',
    coverage: {fixtures, forecastMatches: chosen.size, forecastVersions: forecasts.length}, outcomes: totals, newlySettledForecasts: settledToday,
    byCompetition: Object.entries(byCompetition).map(([competition, v]) => ({competition, ...v})).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
    specialMarkets: Object.fromEntries(Object.entries(special).map(([k, v]) => [k, {settledLines: v.n, brier: v.n ? v.brier / v.n : null, provisional: true}])),
    live: {snapshots: liveRows.length, matches: new Set(liveRows.map(r => r.canonical ?? r.fixtureId)).size, settled: liveRows.filter(r => r.state === 'settled').length, bands: livePerformance(liveRows.filter(r => r.state === 'settled'))},
    rows};
}

export function reportCsv(report) {
  const cols = ['kickoff', 'competition', 'home', 'away', 'forecastAt', 'model', 'home_p', 'draw_p', 'away_p', 'final', 'state', 'result', 'gradedAt'];
  return [cols.join(','), ...report.rows.map(r => cols.map(c => csvCell(typeof r[c] === 'number' ? r[c].toFixed(4) : r[c])).join(','))].join('\n') + '\n';
}

/** Match report: saved pre-match forecasts with grades, and in-play snapshots with settlements, kept apart. */
export async function matchReport(service, id) {
  const s = service.store, ids = [id, ...(await s.all('SELECT b.fixture_id FROM fixture_identities a JOIN fixture_identities b ON a.canonical_id=b.canonical_id WHERE a.fixture_id=? AND b.fixture_id<>a.fixture_id', id)).map(r => r.fixture_id)], m = ids.map(() => '?').join(',');
  const pre = (await s.all(`SELECT p.id,p.fixture_id,p.model_version,p.as_of,p.kickoff_at,p.payload,g.payload grade FROM analysis_forecasts p LEFT JOIN analysis_grades g ON g.id=p.id WHERE p.fixture_id IN (${m}) ORDER BY p.as_of`, ...ids))
    .map(r => { const p = JSON.parse(r.payload); return {id: r.id, model: r.model_version, createdAt: Number(r.as_of), kickoff: Number(r.kickoff_at), probabilities: p.probabilities, expectedGoals: p.expectedGoals, special: p.special ? {corners: p.special.corners?.totals ?? p.special.corners, cards: p.special.cards?.totals ?? p.special.cards} : null, grade: r.grade ? JSON.parse(r.grade) : null}; });
  const live = (await s.all(`SELECT l.id,l.created_at,l.observed_at,l.minute,l.model_version,l.payload,g.state,g.payload grade FROM live_snapshots l LEFT JOIN live_grades g ON g.snapshot_id=l.id WHERE l.fixture_id IN (${m}) ORDER BY l.created_at`, ...ids))
    .map(r => { const p = JSON.parse(r.payload); return {id: r.id, model: r.model_version, createdAt: Number(r.created_at), observedAt: Number(r.observed_at), input: p.input, markets: p.markets, state: r.state ?? 'pending', settlement: r.grade ? JSON.parse(r.grade) : null}; });
  return {fixtureId: id, prematch: pre, live, note: 'Pre-match forecasts and in-play snapshots are graded and reported separately.'};
}
