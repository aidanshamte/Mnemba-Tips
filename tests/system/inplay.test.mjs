// In-play model, live freshness, live settlement and reporting, corners/cards models, capture priority, LiveScore records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {remainingTime, inplayMarkets, evaluateInplay, FRESH_MS} from '../../lib/football/inplay.mjs';
import {settleSnapshot, gradeLive, livePerformance} from '../../lib/football/live-grading.mjs';
import {specialMarkets, settleSpecial, overProbability} from '../../lib/football/special-markets.mjs';
import {normalizeLiveScore} from '../../lib/football/livescore.mjs';
import {dailyReport} from '../../lib/football/reports.mjs';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';

const NOW = Date.parse('2026-11-25T20:00:00Z'), L = [1.5, 1.1];
const sum = o => Object.values(o).reduce((n, x) => n + x, 0);
const fx = (status, elapsed, h, a, extra = {}) => ({id: 'x:1', status, elapsed, homeScore: h, awayScore: a, startsAt: NOW - 3600000, home: {id: 'h', name: 'Home'}, away: {id: 'a', name: 'Away'}, cards: {home: {yellow: 1, red: 0}, away: {yellow: 2, red: 0}}, ...extra});
const run = (f, opts = {}) => evaluateInplay(f, {observedAt: NOW - 20000, now: NOW, baseline: {lambda: L, basis: 'pre-match-forecast'}, events: null, ...opts});

test('remaining time: both halves, half-time, stoppage (capped and explicit), extra time, interruptions, missing minute', () => {
  const mean = r => r.mixture.reduce((n, [t, w]) => n + t * w, 0);
  assert.ok(Math.abs(mean(remainingTime('1H', 10)) - (35 + 45 + 3.08 + 5.43)) < 0.2);
  assert.ok(mean(remainingTime('HT', null)) > 49 && mean(remainingTime('HT', null)) < 51);
  assert.ok(mean(remainingTime('2H', 60)) > 34 && mean(remainingTime('2H', 60)) < 36);
  const capped = mean(remainingTime('2H', 90)), late = mean(remainingTime('2H', 94));
  assert.ok(capped > 0.5 && capped < 5, 'at 90′ some stoppage remains; never zero'); assert.ok(late > 0 && late < capped + 1);
  assert.match(remainingTime('ET', 100).reason, /extra time/i); assert.match(remainingTime('SUSP', 50).reason, /interrupted/i);
  assert.match(remainingTime('2H', null).reason, /minute unavailable/);
});

test('markets are coherent and never offer resolved outcomes, for any score', () => {
  for (const [h, a, m] of [[0, 0, 20], [1, 0, 30], [0, 2, 55], [2, 2, 90], [4, 3, 70], [0, 1, 85]]) {
    const r = remainingTime('2H', Math.max(46, m)).mixture ?? remainingTime('1H', m).mixture, mk = inplayMarkets({home: h, away: a, lambda: L, mixture: r});
    assert.ok(Math.abs(sum(mk.result) - 1) < 1e-9 && Math.abs(sum(mk.nextGoal) - 1) < 1e-9);
    assert.ok(Math.abs(mk.doubleChance.homeOrDraw - (mk.result.home + mk.result.draw)) < 1e-12);
    assert.ok(mk.totals.every(t => t.line > h + a), 'no total line already exceeded');
    assert.equal(mk.btts == null, h > 0 && a > 0, 'BTTS offered only while unresolved');
    assert.ok(Math.abs(mk.anotherGoal - (1 - mk.nextGoal.none)) < 1e-9);
  }
  // 2–2 at 90′: over 2.5 and BTTS have happened and are not offered; another goal is small but not zero.
  const late = inplayMarkets({home: 2, away: 2, lambda: L, mixture: remainingTime('2H', 90).mixture});
  assert.deepEqual(late.totals.map(t => t.line), [4.5, 5.5, 6.5]); assert.equal(late.btts, undefined);
  assert.ok(late.anotherGoal > 0.02 && late.anotherGoal < 0.25); assert.ok(late.result.draw > 0.75);
  // Comeback: trailing late is worse than level; time matters.
  const trail = inplayMarkets({home: 0, away: 1, lambda: L, mixture: remainingTime('2H', 80).mixture}), early = inplayMarkets({home: 0, away: 1, lambda: L, mixture: remainingTime('1H', 20).mixture});
  assert.ok(trail.result.home < early.result.home && trail.result.home > 0);
});

test('live estimates pause on stale, missing or conflicting data, and state their limitations', () => {
  assert.equal(run(fx('2H', 70, 1, 1)).state, 'live');
  // Regression: 2–2 at 90′ with a delayed feed → paused, never a fresh-looking estimate.
  const delayed = run(fx('2H', 90, 2, 2), {observedAt: NOW - FRESH_MS - 1000});
  assert.equal(delayed.state, 'paused'); assert.match(delayed.reason, /waiting for fresh data/);
  assert.equal(run(fx('2H', 70, 1, 1, {hasConflict: true, conflictFields: ['score']})).state, 'paused');
  assert.equal(run(fx('2H', 70, null, 1)).state, 'paused');
  const red = run(fx('2H', 60, 0, 0, {cards: {home: {yellow: 0, red: 1}, away: {yellow: 0, red: 0}}}));
  assert.equal(red.state, 'live'); assert.ok(red.limitations.some(l => /red card has been shown/.test(l))); assert.equal(red.uncertainty, 'High');
  const noCards = run(fx('1H', 30, 0, 0, {cards: undefined}));
  assert.ok(noCards.limitations.some(l => /Red-card information is unavailable/.test(l)), 'missing card data is not treated as no red cards');
  assert.equal(run(fx('HT', null, 1, 0)).state, 'live');
  assert.equal(run(fx('FT', 90, 1, 0)).state, 'unavailable');
  assert.equal(run(fx('2H', 60, 0, 0), {baseline: {reason: 'Three recorded results per team are needed.'}}).state, 'unavailable');
  const hist = run(fx('2H', 60, 0, 0), {baseline: {lambda: L, basis: 'historical-baseline'}});
  assert.ok(hist.limitations.some(l => /No saved pre-match forecast/.test(l)));
});

test('live settlement: final-score markets, next goal only from a complete goal sequence', () => {
  const snap = {input: {home: 1, away: 0, status: '2H', elapsed: 60}, markets: inplayMarkets({home: 1, away: 0, lambda: L, mixture: remainingTime('2H', 60).mixture})};
  const f = {id: 'x:1', home: {id: 'h', name: 'Home'}, away: {id: 'a', name: 'Away'}};
  const goals = [{providerType: 'goal', minute: 20, team: f.home}, {providerType: 'goal', minute: 75, team: f.away}];
  const s = settleSnapshot(snap, {home: 1, away: 1}, goals, f);
  assert.equal(s.result.outcome, 'draw'); assert.equal(s.anotherGoal.outcome, true); assert.deepEqual([s.nextGoal.state, s.nextGoal.outcome], ['settled', 'away']);
  assert.equal(settleSnapshot(snap, {home: 1, away: 1}, [goals[0]], f).nextGoal.state, 'unresolved', 'incomplete sequence is unresolved, never guessed');
  assert.equal(settleSnapshot(snap, {home: 1, away: 0}, null, f).nextGoal.outcome, 'none', 'no further goal settles from the final score');
  assert.ok(s.totals.every(t => t.outcome === (2 > t.line ? 'over' : 'under')));
});

async function world(now = NOW) {
  const db = database(); db.store.now = () => now; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize(); return {...db, service};
}

test('gradeLive is idempotent, records corrections and voids abandoned matches', async () => {
  const w = await world();
  try {
    const f = normalizeFixture('api-football', apiFixture(7001, 'FT', '2026-11-25T17:00:00Z', 10, 20));
    await w.service.saveFixtures([{...f, homeScore: 2, awayScore: 1}]);
    const markets = inplayMarkets({home: 1, away: 1, lambda: L, mixture: remainingTime('2H', 70).mixture});
    await w.store.run('INSERT INTO live_snapshots(id,fixture_id,canonical_id,model_version,created_at,observed_at,minute,payload) VALUES(?,?,?,?,?,?,?,?)', 's1', f.id, null, 'inplay-poisson-1', NOW - 3600000, NOW - 3600000, 70, JSON.stringify({input: {home: 1, away: 1, status: '2H', elapsed: 70}, markets}));
    assert.equal((await gradeLive(w.service)).settled, 1);
    await gradeLive(w.service);
    assert.equal(Number((await w.store.one('SELECT COUNT(*) n FROM live_grades')).n), 1, 'no duplicate grade');
    assert.equal(JSON.parse((await w.store.one('SELECT payload FROM live_grades')).payload).result.outcome, 'home');
    // A corrected final (2–2): the pending re-check is only for unsettled rows, so force a correction path by status.
    await w.store.run("UPDATE live_grades SET state='pending'");
    await w.service.saveFixtures([{...f, homeScore: 2, awayScore: 2}]);
    await gradeLive(w.service);
    const g = JSON.parse((await w.store.one('SELECT payload FROM live_grades')).payload);
    assert.equal(g.result.outcome, 'draw'); assert.equal(g.revisions.length, 1, 'previous settlement kept');
  } finally { w.sqlite.close(); }
});

test('live performance weights each match once per minute band', () => {
  const g = (correct, brier) => ({result: {correct, brier, logLoss: brier}});
  const rows = [...Array(10)].map(() => ({fixtureId: 'a', band: '76′+', grade: g(true, 0.1)})).concat([{fixtureId: 'b', band: '76′+', grade: g(false, 0.9)}]);
  const band = livePerformance(rows).find(b => b.band === '76′+');
  assert.deepEqual([band.matches, band.snapshots], [2, 11]); assert.ok(Math.abs(band.brier - 0.5) < 1e-9, 'not dominated by repeated updates');
});

test('corners and cards: own count models, withheld without enough history, settled only from counts', () => {
  const team = (id, name) => ({id, name}), H = team('h', 'Home'), A = team('a', 'Away'), O = team('o', 'Other');
  const hist = []; let t = NOW - 400 * 86400000;
  for (let i = 0; i < 30; i++) { t += 86400000; hist.push({startsAt: t, status: 'FT', home: i % 2 ? H : O, away: i % 2 ? O : A, homeScore: 0, awayScore: 0, corners: {home: 7, away: 3}, cards: {home: {yellow: 2, red: 0}, away: {yellow: 1, red: 0}}}); }
  const f = {home: H, away: A, startsAt: NOW}, m = specialMarkets(f, hist, NOW);
  assert.ok(m.provisional && m.corners.expected[0] > m.corners.expected[1], 'home side wins more corners in its history');
  const overs = m.corners.totals.map(x => x.over); assert.ok(overs.every((p, i) => !i || p <= overs[i - 1]), 'higher line, lower over probability');
  assert.match(specialMarkets(f, hist.slice(0, 12), NOW).corners.withheld, /recorded matches with corners counts/);
  // Goals are irrelevant to the corner model.
  const goals = specialMarkets(f, hist.map(g => ({...g, homeScore: 5, awayScore: 4})), NOW);
  assert.deepEqual(goals.corners.expected, m.corners.expected);
  assert.equal(settleSpecial(m, {corners: {home: 6, away: 5}, cards: undefined}).cards.state, 'pending');
  assert.equal(settleSpecial(m, {corners: {home: 6, away: 5}}).corners.totals.find(x => x.line === 10.5).outcome, 'over');
  assert.ok(Math.abs(overProbability(3, Infinity, 2.5) - (1 - Math.exp(-3) * (1 + 3 + 4.5))) < 1e-12);
});

test('capture reaches an approaching kickoff behind the batch cursor', async () => {
  const w = await world(Date.parse('2026-11-25T10:00:00Z'));
  try {
    const past = []; for (let i = 1; i <= 5; i++) past.push(normalizeFixture('api-football', apiFixture(8000 + i, 'FT', `2026-10-0${i}T15:00:00Z`, 10, 20)), normalizeFixture('api-football', apiFixture(8100 + i, 'FT', `2026-10-0${i}T18:00:00Z`, 20, 10)));
    await w.service.saveFixtures(past);
    const soon = normalizeFixture('api-football', apiFixture(8200, 'NS', '2026-11-25T18:00:00Z', 10, 20));
    await w.service.saveFixtures([soon]);
    await w.store.upsert('analysis_batches', {id: 'b', window_start: Date.parse('2026-11-25'), window_end: Date.parse('2027-01-01'), cursor_time: Date.parse('2026-11-27'), cursor_id: '', state: 'running', updated_at: 0});
    await new ModelLab(w.service).update({pageSize: 10});
    assert.ok(await w.store.one('SELECT state FROM analysis_processing WHERE fixture_id=?', soon.id), 'approaching kickoff attempted although behind the cursor');
    assert.equal((await w.store.one("SELECT cursor_time FROM analysis_batches WHERE id='b'")).cursor_time, Date.parse('2026-11-27'), 'cursor not moved backwards');
  } finally { w.sqlite.close(); }
});

test('daily report: pending is not a loss; versions and matches counted separately', async () => {
  const w = await world();
  try {
    const f = normalizeFixture('api-football', apiFixture(9001, 'NS', '2026-11-25T18:00:00Z', 10, 20));
    await w.service.saveFixtures([f]);
    for (const [id, asOf] of [['p1', f.startsAt - 7200000], ['p2', f.startsAt - 5400000]]) await w.store.run('INSERT INTO analysis_forecasts(id,fixture_id,model_version,as_of,kickoff_at,max_known_at,training_allowed,payload,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)', id, f.id, 'poisson-temporal-1', asOf, f.startsAt, asOf - 1, 1, JSON.stringify({probabilities: [0.5, 0.3, 0.2]}), '[]');
    const r = await dailyReport(w.service, new URLSearchParams({date: '2026-11-25', timezone: 'UTC'}));
    assert.deepEqual([r.coverage.forecastMatches, r.coverage.forecastVersions], [1, 2]);
    assert.equal(r.outcomes.pending, 1); assert.equal(r.outcomes.lost, 0);
    assert.equal(r.rows[0].forecastAt, new Date(f.startsAt - 5400000).toISOString(), 'latest pre-kickoff version is the headline');
  } finally { w.sqlite.close(); }
});

test('an unknown LiveScore status is a record-level error with sanitized values', () => {
  const board = JSON.parse(readFileSync(new URL('../fixtures/livescore/scoreboard.json', import.meta.url)));
  assert.throws(() => normalizeLiveScore({...board, Eps: 'Aban.<x>'}, board.Stg, {compactTimestampTimezone: 'UTC'}), e => e.name === 'LiveScoreRecordError' && /Eps="Aban.x"/.test(e.message));
});

test('worker capture stores one snapshot per state, and the read path pauses a stale estimate', async () => {
  const {captureInplay} = await import('../../lib/football/inplay.mjs');
  const {inplayFor} = await import('../../lib/football/live.mjs');
  let now = Date.parse('2026-11-25T16:00:00Z'); const db = database(); db.store.now = () => now; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  try {
    const past = []; for (let i = 1; i <= 5; i++) past.push(normalizeFixture('api-football', apiFixture(9100 + i, 'FT', `2026-10-0${i}T15:00:00Z`, 10, 20)), normalizeFixture('api-football', apiFixture(9200 + i, 'FT', `2026-10-0${i}T18:00:00Z`, 20, 10)));
    await service.saveFixtures(past);
    const live = {...normalizeFixture('api-football', apiFixture(9300, '2H', '2026-11-25T15:00:00Z', 10, 20)), elapsed: 60, homeScore: 1, awayScore: 0};
    await service.saveFixtures([live]);
    const a = await captureInplay(service, live.id);
    assert.equal(a.state, 'live'); assert.equal(a.baseline.basis, 'historical-baseline');
    await captureInplay(service, live.id);
    assert.equal(Number((await db.store.one('SELECT COUNT(*) n FROM live_snapshots')).n), 1, 'unchanged state is not stored twice');
    assert.equal((await inplayFor(db.store, [live.id])).state, 'live');
    now += FRESH_MS + 60000;
    const later = await inplayFor(db.store, [live.id]);
    assert.equal(later.state, 'paused'); assert.equal(later.previous.input.home, 1, 'previous estimate kept with its original state');
  } finally { db.sqlite.close(); }
});

test('a live match without any in-play result gets a stated reason, not silence', async () => {
  const {liveSnapshot, publishLive} = await import('../../lib/football/live.mjs');
  const db = database(); db.store.now = () => NOW; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  try {
    const live = {...normalizeFixture('api-football', apiFixture(9400, '2H', '2026-11-25T19:00:00Z', 10, 20)), elapsed: 50, homeScore: 0, awayScore: 0};
    await service.saveFixtures([live]); await publishLive(service, live.id);
    await db.store.run("DELETE FROM football_cache WHERE id LIKE 'inplay:%'");
    const snap = await liveSnapshot(db.store, live.id);
    assert.equal(snap.inplay.state, 'paused'); assert.match(snap.inplay.reason, /waiting for fresh data/);
  } finally { db.sqlite.close(); }
});

test('worker sweep gives every live match an in-play result without waiting for a change', async () => {
  const {sweepInplay} = await import('../../lib/football/inplay.mjs');
  const db = database(); db.store.now = () => NOW; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  try {
    const live = {...normalizeFixture('api-football', apiFixture(9500, '1H', '2026-11-25T19:40:00Z', 10, 20)), elapsed: 20, homeScore: 0, awayScore: 0};
    await service.saveFixtures([live]);
    const r = await sweepInplay(service);
    assert.equal(r.refreshed, 1); assert.ok((await db.store.cache(`inplay:${live.id}`)).data.state);
    assert.equal((await sweepInplay(service)).refreshed, 0, 'not recomputed within a minute');
  } finally { db.sqlite.close(); }
});
