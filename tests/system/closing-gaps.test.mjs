// Closing pass: linked-final settlement with provenance, partial settlement, bounded LiveScore reconciliation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {normalizeLiveScore} from '../../lib/football/livescore.mjs';
import {liveTick} from '../../lib/football/live.mjs';
import {gradeLive, verifiedFinal, marketStates} from '../../lib/football/live-grading.mjs';
import {inplayMarkets, remainingTime} from '../../lib/football/inplay.mjs';

const L = [1.3, 1.1];
async function world(now, env = {}, fetcher) {
  const db = database(); let t = now; db.store.now = () => t; await db.store.init();
  const service = new IntelligenceService(db.store, env, fetcher ? {fetcher, sleep: async () => {}} : {}); await service.initialize();
  return {...db, service, advance: ms => { t += ms; }};
}
const snapshot = (store, id, fixtureId, input, at) => store.run('INSERT INTO live_snapshots(id,fixture_id,canonical_id,model_version,created_at,observed_at,minute,payload) VALUES(?,?,?,?,?,?,?,?)', id, fixtureId, null, 'inplay-poisson-1', at, at, input.elapsed, JSON.stringify({input, markets: inplayMarkets({home: input.home, away: input.away, lambda: L, mixture: remainingTime(input.status, input.elapsed).mixture})}));
const link = async (store, ids) => { for (const id of ids) await store.run("INSERT INTO fixture_identities(fixture_id,canonical_id,verification) VALUES(?,?,'test') ON CONFLICT(fixture_id) DO UPDATE SET canonical_id=excluded.canonical_id", id, 'fixture:linked'); };

test('a stuck record settles only from an agreeing, same-orientation linked final, with provenance; disagreement is a conflict', async () => {
  const now = Date.parse('2026-11-26T12:00:00Z'), w = await world(now);
  try {
    const stuck = {...normalizeFixture('api-football', apiFixture(9601, '2H', '2026-11-24T15:00:00Z', 10, 20)), homeScore: 1, awayScore: 1, elapsed: 80};
    const fin = {...normalizeFixture('api-football', apiFixture(9602, 'FT', '2026-11-24T15:00:00Z', 10, 20)), homeScore: 2, awayScore: 1};
    await w.service.saveFixtures([stuck, fin]); await link(w.store, [stuck.id, fin.id]);
    await snapshot(w.store, 'k1', stuck.id, {home: 1, away: 1, status: '2H', elapsed: 70}, Date.parse('2026-11-24T16:20:00Z'));
    const vf = await verifiedFinal(w.service, stuck);
    assert.deepEqual(vf.score, {home: 2, away: 1}); assert.equal(vf.source.fixtureId, fin.id);
    const r = await gradeLive(w.service);
    const g = JSON.parse((await w.store.one('SELECT payload FROM live_grades')).payload);
    assert.equal(g.resultSource.fixtureId, fin.id, 'provenance recorded');
    assert.equal(r.partial, 1, 'next goal needs a complete goal sequence: partial, not settled');
    assert.deepEqual([g.markets.result, g.markets.nextGoal], ['settled', 'unresolved']);
    // Goal sequence arrives for the final's record: the partial snapshot completes on a later run.
    await w.service.detailRecord('fixture_events', fin, [{time: {elapsed: 20}, team: {id: fin.home.id}, type: 'Goal', detail: 'Normal Goal'}, {time: {elapsed: 30}, team: {id: fin.away.id}, type: 'Goal', detail: 'Normal Goal'}, {time: {elapsed: 85}, team: {id: fin.home.id}, type: 'Goal', detail: 'Normal Goal'}]);
    await gradeLive(w.service);
    const done = await w.store.one('SELECT state,payload FROM live_grades');
    assert.equal(done.state, 'settled'); assert.equal(JSON.parse(done.payload).nextGoal.outcome, 'home'); assert.equal(JSON.parse(done.payload).revisions.length, 1, 'correction audited');
    await gradeLive(w.service); assert.equal(Number((await w.store.one('SELECT COUNT(*) n FROM live_grades')).n), 1, 'no duplicate');
    // A second linked final with another score is a conflict, never averaged or guessed.
    const other = {...normalizeFixture('api-football', apiFixture(9603, 'FT', '2026-11-24T15:00:00Z', 10, 20)), homeScore: 3, awayScore: 1};
    await w.service.saveFixtures([other]); await link(w.store, [other.id]);
    assert.match((await verifiedFinal(w.service, stuck)).conflict, /disagree/);
  } finally { w.sqlite.close(); }
});

test('market states distinguish settled, void, unresolved and not offered', () => {
  assert.deepEqual(marketStates({result: {outcome: 'home'}, totals: [{}], nextGoal: {state: 'unresolved'}, anotherGoal: {outcome: true}}),
    {result: 'settled', doubleChance: 'settled', totals: 'settled', btts: 'not offered', anotherGoal: 'settled', nextGoal: 'unresolved'});
});

test('LiveScore reconciliation: a match stuck in play days later is re-checked once in the shared slot; a final comes only from the scoreboard', async () => {
  const board = JSON.parse(readFileSync(new URL('../fixtures/livescore/scoreboard.json', import.meta.url)));
  const kickoff = Date.parse('2026-09-24T14:00:00Z');
  let calls = 0, reply = {...board, Eps: 'FT', Esid: 6, Tr1: '3', Tr2: '1'};
  const fetcher = async url => { calls++; assert.match(String(url), /scoreboard\/soccer\/1894365$/); return Response.json(reply); };
  const w = await world(kickoff + 2 * 864e5, {MNEMBA_LIVESCORE_ENABLED: '1'}, fetcher);
  try {
    const stuck = {...normalizeLiveScore(board, board.Stg, {compactTimestampTimezone: 'UTC'}), status: '2H'};
    await w.service.saveFixtures([stuck]);
    await w.store.putCache('live:discovery:livescore', {count: 0}, 86400000);
    const r = await liveTick(w.service, {cadenceMs: 60000});
    assert.equal(r.state, 'success'); assert.equal(calls, 1);
    assert.equal((await w.store.one('SELECT status FROM fixtures WHERE id=?', stuck.id)).status, 'FT', 'final from the provider scoreboard');
    w.advance(61000);
    assert.equal((await liveTick(w.service, {cadenceMs: 60000})).state, 'idle', 'not re-checked within 6 h');
    assert.equal(calls, 1);
  } finally { w.sqlite.close(); }
});

test('health signals count stalled live records; CSV carries corner/card settlement from verified counts', async () => {
  const {ModelLab} = await import('../../lib/football/model-lab.mjs');
  const {dailyReport, reportCsv} = await import('../../lib/football/reports.mjs');
  const {specialMarkets, settleSpecial} = await import('../../lib/football/special-markets.mjs');
  const now = Date.parse('2026-11-26T12:00:00Z'), w = await world(now);
  try {
    await w.service.saveFixtures([{...normalizeFixture('api-football', apiFixture(9701, '2H', '2026-11-25T15:00:00Z', 10, 20)), elapsed: 80}]);
    assert.equal((await new ModelLab(w.service).health()).stalledLive, 1);
    const f = {...normalizeFixture('api-football', apiFixture(9702, 'NS', '2026-11-26T09:00:00Z', 10, 20))};
    await w.service.saveFixtures([f]);
    const hist = []; for (let i = 0; i < 24; i++) hist.push({startsAt: now - (40 - i) * 864e5, status: 'FT', home: i % 2 ? f.home : {id: 'o'}, away: i % 2 ? {id: 'o'} : f.away, corners: {home: 6, away: 4}, cards: {home: {yellow: 2, red: 0}, away: {yellow: 1, red: 1}}});
    const special = specialMarkets(f, hist, f.startsAt), asOf = f.startsAt - 3600000;
    await w.store.run('INSERT INTO analysis_forecasts(id,fixture_id,model_version,as_of,kickoff_at,max_known_at,training_allowed,payload,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)', 'fs1', f.id, 'poisson-temporal-1', asOf, f.startsAt, asOf - 1, 1, JSON.stringify({probabilities: [0.5, 0.3, 0.2], special}), '[]');
    const settled = settleSpecial(special, {corners: {home: 7, away: 5}, cards: {home: {yellow: 3, red: 0}, away: {yellow: 1, red: 1}}});
    await w.store.run('INSERT INTO analysis_grade_audit(id,forecast_id,fixture_id,recorded_at,state,revision,payload) VALUES(?,?,?,?,?,?,?)', 'ga1', 'fs1', f.id, now, 'graded', 'r1', JSON.stringify({homeScore: 1, awayScore: 0, resultCorrect: true, special: settled}));
    const csv = reportCsv(await dailyReport(w.service, new URLSearchParams({date: '2026-11-26', timezone: 'UTC'}))).split('\n');
    const head = csv[0].split(','), row = csv[1].split(','), col = k => row[head.indexOf(k)];
    assert.deepEqual([col('corners_state'), col('corners_count'), col('corners_over_9.5_outcome')], ['settled', '12', 'over']);
    assert.deepEqual([col('cards_state'), col('cards_count'), col('cards_over_3.5_outcome')], ['settled', '5', 'over'], 'yellow + red as counted by the source');
  } finally { w.sqlite.close(); }
});
