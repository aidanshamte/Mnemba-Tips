// Settlement and reporting for in-play snapshots, separate from pre-match grading.
// Final-score markets settle on a verified regulation-time result; next goal needs a complete, authoritative goal
// sequence (otherwise unresolved). Re-running never duplicates grades; a changed result keeps the prior revision.
import {matchTimeline} from './events.mjs';
import {matchState} from './match-state.mjs';

const FINAL = new Set(['FT', 'FINISHED']);
export const BANDS = [[0, 15, '1–15′'], [16, 30, '16–30′'], [31, 45, '31–45′'], [46, 60, 'Half-time–60′'], [61, 75, '61–75′'], [76, 200, '76′+']];
export const bandOf = (minute, status) => status === 'HT' ? 'Half-time–60′' : (BANDS.find(([a, b]) => (minute ?? 0) >= a && (minute ?? 0) <= b) ?? BANDS[0])[2];

/**
 * Abandoned match (documented rule): markets already decided when play stopped stand — a total line already exceeded,
 * both teams having scored, another goal having occurred, and the next goal when the complete goal sequence shows it.
 * Result, double chance and undecided totals are void. An unknown score at abandonment voids everything.
 */
export function settleAbandoned(payload, atStop, events, fixture) {
  const {input, markets} = payload;
  if (!Number.isInteger(atStop?.home) || !Number.isInteger(atStop?.away)) return {abandoned: true, reason: 'Abandoned; score at abandonment unknown, all markets void', result: {state: 'void'}};
  const h = atStop.home, a = atStop.away, more = h + a > input.home + input.away;
  const out = {abandoned: true, atAbandonment: {home: h, away: a}, result: {state: 'void'}, doubleChance: {state: 'void'},
    totals: (markets.totals ?? []).map(t => h + a > t.line ? {line: t.line, over: t.over, outcome: 'over'} : {line: t.line, state: 'void'}),
    anotherGoal: more ? {outcome: true, p: markets.anotherGoal} : {state: 'void'}};
  if (markets.btts) out.btts = h > 0 && a > 0 ? {outcome: true, p: markets.btts.yes} : {state: 'void'};
  if (more) {
    const goals = matchTimeline(events ?? [], fixture).events.filter(e => ['goal', 'penalty-goal', 'own-goal'].includes(e.kind) && !e.disallowed);
    out.nextGoal = goals.length === h + a && goals.every(g => g.side) && !goals.some(g => g.kind === 'own-goal') ? {state: 'settled', outcome: goals[input.home + input.away].side, p: markets.nextGoal} : {state: 'unresolved', reason: 'Complete goal sequence unavailable from the source'};
  } else out.nextGoal = {state: 'void'};
  return out;
}

/** Pure settlement of one snapshot payload against a verified final (and optional event rows). */
export function settleSnapshot(payload, final, events, fixture) {
  const {input, markets} = payload, h = final.home, a = final.away, outcome = h > a ? 'home' : h === a ? 'draw' : 'away';
  const p = markets.result, brier = ['home', 'draw', 'away'].reduce((n, k) => n + (p[k] - (k === outcome ? 1 : 0)) ** 2, 0);
  const pick = Object.entries(p).sort((x, y) => y[1] - x[1])[0][0];
  const totals = (markets.totals ?? []).map(t => ({line: t.line, over: t.over, outcome: h + a > t.line ? 'over' : 'under'}));
  const another = h + a > input.home + input.away;
  let nextGoal = {state: 'settled', outcome: 'none'};
  if (another) {
    const goals = matchTimeline(events ?? [], fixture).events.filter(e => ['goal', 'penalty-goal', 'own-goal'].includes(e.kind) && !e.disallowed);
    // Only a complete sequence with known sides and no own goals (whose side conventions differ by source) settles it.
    if (goals.length === h + a && goals.every(g => g.side) && !goals.some(g => g.kind === 'own-goal')) {
      const next = goals[input.home + input.away];
      nextGoal = {state: 'settled', outcome: next.side};
    } else nextGoal = {state: 'unresolved', reason: 'Complete goal sequence unavailable from the source'};
  }
  return {final: {home: h, away: a}, result: {outcome, pick, correct: pick === outcome, brier, logLoss: -Math.log(Math.max(1e-12, p[outcome]))},
    totals, anotherGoal: {outcome: another, p: markets.anotherGoal}, nextGoal: {...nextGoal, p: markets.nextGoal},
    ...(markets.btts ? {btts: {outcome: h > 0 && a > 0, p: markets.btts.yes}} : {})};
}

/** Market-level states for a settlement; the snapshot is 'partial' when a market remains unresolved. */
export function marketStates(p) {
  const st = x => x == null ? 'not offered' : x.state === 'unresolved' ? 'unresolved' : x.state === 'void' ? 'void' : 'settled';
  return {result: st(p.result), doubleChance: p.doubleChance ? st(p.doubleChance) : p.result ? 'settled' : 'not offered', totals: p.totals?.length ? 'settled' : 'not offered', btts: st(p.btts), anotherGoal: st(p.anotherGoal), nextGoal: st(p.nextGoal)};
}

/**
 * Verified regulation-time final for a fixture: its own record, else linked records of the same canonical fixture
 * that all agree, with the same home/away orientation (provenance recorded). Disagreement is a conflict. Elapsed time
 * or a feed dropping a match is never evidence of a final.
 */
export async function verifiedFinal(service, f) {
  const s = service.store, reg = x => FINAL.has(String(x.status).toUpperCase()) ? {home: x.homeScore, away: x.awayScore} : x.regulationScore;
  if (matchState(f, s.now()).state === 'completed') { const sc = reg(f); if (sc && Number.isInteger(sc.home) && Number.isInteger(sc.away)) return {score: sc, record: f, source: {fixtureId: f.id, provider: f.provider, status: f.status}}; }
  const sibs = (await s.all("SELECT f2.payload FROM fixture_identities a JOIN fixture_identities b ON b.canonical_id=a.canonical_id AND b.fixture_id<>a.fixture_id JOIN fixtures f2 ON f2.id=b.fixture_id WHERE a.fixture_id=? AND f2.status IN ('FT','FINISHED','AET','PEN')", f.id)).map(r => JSON.parse(r.payload));
  const finals = sibs.map(g => ({g, sc: reg(g)})).filter(x => x.sc && Number.isInteger(x.sc.home) && Number.isInteger(x.sc.away));
  if (!finals.length) return null;
  const canon = await service.aliasMap([f.home.id, f.away.id, ...finals.flatMap(x => [x.g.home.id, x.g.away.id])]), k = id => canon.get(id) ?? id;
  const oriented = finals.filter(x => k(x.g.home.id) === k(f.home.id) && k(x.g.away.id) === k(f.away.id));
  if (!oriented.length) return {conflict: 'Linked final has a different home/away orientation'};
  if (new Set(oriented.map(x => `${x.sc.home}-${x.sc.away}`)).size > 1) return {conflict: `Linked finals disagree: ${oriented.map(x => `${x.g.provider} ${x.sc.home}-${x.sc.away}`).join(', ')}`};
  return {score: oriented[0].sc, record: oriented[0].g, source: {fixtureId: oriented[0].g.id, provider: oriented.map(x => x.g.provider).join(', '), status: oriented[0].g.status, linkedTo: f.id}};
}

export async function gradeLive(service, {limit = 500} = {}) {
  const s = service.store, now = s.now();
  // Ungraded and pending first; partial settlements are re-checked for 48 h in case the event sequence completes.
  const rows = await s.all("SELECT l.id,l.fixture_id,l.canonical_id,l.payload,g.payload grade,g.state gstate FROM live_snapshots l LEFT JOIN live_grades g ON g.snapshot_id=l.id WHERE g.snapshot_id IS NULL OR g.state IN ('pending','conflict') OR (g.state='partial' AND l.created_at>?) ORDER BY CASE WHEN g.snapshot_id IS NULL THEN 0 WHEN g.state='pending' THEN 1 ELSE 2 END,l.created_at LIMIT ?", now - 48 * 3600000, limit);
  const out = {checked: rows.length, settled: 0, partial: 0, voided: 0, abandoned: 0, conflict: 0, pending: 0, failed: 0};
  for (const r of rows) {
    try {
      const fx = await s.one('SELECT payload FROM fixtures WHERE id=?', r.fixture_id); if (!fx) continue;
      const f = JSON.parse(fx.payload), lifecycle = matchState(f, now);
      let state = 'pending', payload = {reason: 'Awaiting a verified regulation-time result'};
      if (lifecycle.state === 'cancelled') { state = 'void'; payload = {reason: 'Cancelled'}; }
      else if (['ABD', 'ABANDONED'].includes(String(f.status).toUpperCase())) {
        const ev = await s.one('SELECT payload FROM fixture_events WHERE fixture_id=?', r.fixture_id);
        payload = settleAbandoned(JSON.parse(r.payload), {home: f.homeScore, away: f.awayScore}, ev ? JSON.parse(ev.payload) : null, f); state = 'abandoned';
      } else {
        const fin = await verifiedFinal(service, f);
        if (fin?.conflict) { state = 'conflict'; payload = {reason: fin.conflict}; }
        else if (fin) {
          // Events from the record that supplied the final, else this record's own events.
          const ev = await s.one('SELECT payload FROM fixture_events WHERE fixture_id=?', fin.record.id) ?? await s.one('SELECT payload FROM fixture_events WHERE fixture_id=?', r.fixture_id);
          payload = settleSnapshot(JSON.parse(r.payload), fin.score, ev ? JSON.parse(ev.payload) : null, fin.record);
          payload.resultSource = fin.source; payload.markets = marketStates(payload);
          state = Object.values(payload.markets).includes('unresolved') ? 'partial' : 'settled';
        } else if (lifecycle.state === 'completed') payload = {reason: 'Regulation-time score unavailable; extra time and shootouts excluded'};
      }
      out[state === 'void' ? 'voided' : state]++;
      const prior = r.grade ? JSON.parse(r.grade) : null;
      if (prior && JSON.stringify({...prior, revisions: undefined}) === JSON.stringify(payload)) continue;
      const revisions = prior ? [...(prior.revisions ?? []), {at: now, state: r.gstate, previous: {...prior, revisions: undefined}}].slice(-5) : undefined;
      await s.run('INSERT INTO live_grades(snapshot_id,fixture_id,state,settled_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(snapshot_id) DO UPDATE SET state=excluded.state,settled_at=excluded.settled_at,payload=excluded.payload',
        r.id, r.fixture_id, state, now, JSON.stringify(revisions ? {...payload, revisions} : payload));
    } catch (e) { out.failed++; console.error('mnemba_live_grade', r.id, String(e.message).slice(0, 160)); }
  }
  return out;
}

/** Live performance by minute band. Fixture-weighted: each match contributes its mean, so repeated updates do not count as separate matches. */
export function livePerformance(rows) {
  const out = [];
  for (const [, , label] of BANDS) {
    const list = rows.filter(r => r.band === label && r.grade?.result), byFixture = new Map();
    for (const r of list) { const k = r.canonical ?? r.fixtureId; (byFixture.get(k) ?? byFixture.set(k, []).get(k)).push(r.grade.result); }
    const per = [...byFixture.values()].map(x => ({brier: x.reduce((n, g) => n + g.brier, 0) / x.length, logLoss: x.reduce((n, g) => n + g.logLoss, 0) / x.length, hit: x.filter(g => g.correct).length / x.length}));
    const mean = k => per.length ? per.reduce((n, x) => n + x[k], 0) / per.length : null;
    out.push({band: label, matches: per.length, snapshots: list.length, brier: mean('brier'), logLoss: mean('logLoss'), hitRate: mean('hit')});
  }
  return out;
}

export async function livePerformanceView(store) {
  const rows = (await store.all("SELECT l.fixture_id,l.canonical_id,l.minute,l.payload,g.payload grade FROM live_snapshots l JOIN live_grades g ON g.snapshot_id=l.id WHERE g.state IN ('settled','partial')")).map(r => {
    const p = JSON.parse(r.payload); return {fixtureId: r.fixture_id, canonical: r.canonical_id, band: bandOf(r.minute, p.input?.status), grade: JSON.parse(r.grade)}; });
  const counts = await store.all('SELECT state,COUNT(*) n FROM live_grades GROUP BY state');
  return {model: 'inplay-poisson-1', provisional: true, bands: livePerformance(rows), grades: Object.fromEntries(counts.map(c => [c.state, Number(c.n)])),
    note: 'Result metrics include fully and partially settled snapshots (partial: the result is settled and at least one market, usually next goal, is unresolved). In-play snapshots only, reported separately from pre-match forecasts. Late-match estimates are easier and are not evidence of pre-match accuracy. Each match is weighted once per band.'};
}
