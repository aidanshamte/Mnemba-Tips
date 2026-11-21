// Matchday coverage: every visible fixture is listed with an honest analysis state, independent of prediction
// eligibility and of whether its league is on the priority list. Private competitions stay out of public lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {matchdayView} from '../../lib/football/recommendations.mjs';
import {computeAnalysisStates, classifyAnalysis} from '../../lib/football/analysis-states.mjs';

const KICKOFF = '2026-11-05T12:00:00Z';
async function world() {
  const db = database(); let now = Date.parse('2026-11-04T12:00:00Z'); db.store.now = () => now;
  await db.store.init(); const service = new IntelligenceService(db.store); await service.initialize();
  const past = [];
  const game = (id, home, away, day) => normalizeFixture('api-football', apiFixture(id, 'FT', `2026-10-${String(day).padStart(2, '0')}T15:00:00Z`, home, away));
  for (let i = 1; i <= 9; i++) past.push(game(1000 + i, 10, 100 + i, i), game(1100 + i, 20, 200 + i, i));   // 9 results each
  for (let i = 1; i <= 4; i++) past.push(game(1200 + i, 40, 300 + i, i + 10), game(1300 + i, 50, 400 + i, i + 10)); // 4 each
  await service.saveFixtures(past);
  const full = normalizeFixture('api-football', apiFixture(2001, 'NS', KICKOFF, 10, 20));
  const early = normalizeFixture('api-football', apiFixture(2002, 'NS', KICKOFF, 40, 50));
  const waiting = normalizeFixture('api-football', apiFixture(2003, 'NS', KICKOFF, 60, 70));
  const base = normalizeFixture('api-football', apiFixture(2004, 'NS', KICKOFF, 80, 90));
  const hidden = {...base, id: 'fivedollar:2004', provider: 'fivedollar', competition: {...base.competition, id: 'fivedollar:l77', provider: 'fivedollar', externalId: '77', name: 'Ghana Premier League', seasons: [{...base.competition.seasons[0], id: 'fivedollar:l77:2026', competitionId: 'fivedollar:l77'}]}, seasonId: 'fivedollar:l77:2026'};
  await service.saveFixtures([full, early, waiting, hidden]);
  return {...db, service, full, early, waiting, hidden, at: t => { now = Date.parse(t); }};
}
const params = () => new URLSearchParams({day: 'date', from: '2026-11-05', timezone: 'UTC'});

test('analysis states: full needs evidence, early estimates are labelled, missing evidence waits', () => {
  const f = {competition: {name: 'Eerste Divisie'}};
  const probs = [0.5, 0.3, 0.2];
  assert.equal(classifyAnalysis(f, {probabilities: probs, factors: {home: {games: 9, restDays: 7}, away: {games: 10, restDays: 7}}}, {}).state, 'full');
  assert.equal(classifyAnalysis(f, {probabilities: probs, factors: {home: {games: 4, restDays: 7}, away: {games: 9, restDays: 7}}}, {}).state, 'provisional');
  assert.equal(classifyAnalysis(f, {probabilities: probs, factors: {home: {games: 9, restDays: 7}, away: {games: 9, restDays: 7}}}, {reason: 'No validated model for this age/gender category; club-league parameters are not transferred.'}).state, 'provisional');
  assert.equal(classifyAnalysis(f, {reason: 'Three recorded results per team are needed for a supported projection.'}, {}).state, 'waiting');
  assert.equal(classifyAnalysis(f, {probabilities: [0.9, 0.9, 0.2], factors: {home: {games: 9}, away: {games: 9}}}, {}).state, 'waiting', 'invalid probabilities are never shown');
  const w = classifyAnalysis(f, {}, {});
  assert.equal(w.reason, 'Analysis is waiting for enough verified data.'); assert.equal(w.main, null); assert.equal(w.recommendation, null);
});

test('every visible fixture is listed with its analysis state; private competitions are hidden; picks are a stricter subset', async () => {
  const w = await world();
  try {
    const before = await matchdayView(w.service, params());
    assert.equal(before.count, 3, 'visible before any analysis is computed');
    assert.ok(!before.fixtures.some(f => f.id === w.hidden.id), 'unmapped licensed-provider league stays private');
    await w.service.store.run("DELETE FROM football_cache WHERE id LIKE 'matchday:%'");
    const run = await w.service.sync('analysis-states');
    assert.equal(run.considered, 3); assert.equal(run.computed, 3);
    assert.deepEqual([run.full, run.provisional, run.waiting], [1, 1, 1]);
    const view = await matchdayView(w.service, params());
    assert.equal(view.count, 3, 'visibility does not depend on prediction eligibility');
    assert.deepEqual(view.analysis, {full: 1, provisional: 1, waiting: 1, pending: 0});
    const state = id => view.fixtures.find(f => f.id === id).analysisState.state;
    assert.deepEqual([state(w.full.id), state(w.early.id), state(w.waiting.id)], ['full', 'provisional', 'waiting']);
    assert.ok(view.picks.every(p => state(p.fixture.id) === 'full'), 'top picks come only from full analyses');
    assert.ok(view.picks.length <= 5);
  } finally { w.sqlite.close(); }
});

test('the analysis stage is time-boxed and resumes stalest-first without repeating fresh work', async () => {
  const w = await world();
  try {
    const stopped = await computeAnalysisStates(w.service, {stopAt: w.store.now()});
    assert.equal(stopped.computed, 0); assert.equal(stopped.stoppedEarly, true);
    const first = await computeAnalysisStates(w.service, {});
    assert.equal(first.computed, 4, 'without a visibility filter every not-started fixture is considered');
    const second = await computeAnalysisStates(w.service, {});
    assert.equal(second.computed, 0); assert.equal(second.fresh, 4, 'fresh states are not recomputed');
    const stage = await w.service.sync('analysis-states');
    assert.equal(stage.outcome, 'success');
  } finally { w.sqlite.close(); }
});

test('the matchday view reads only the rows it needs (no whole-table reads of identities, aliases or cache)', async () => {
  const w = await world();
  try {
    await w.service.sync('analysis-states');
    const seen = [], all = w.store.all.bind(w.store);
    w.store.all = (sql, ...args) => { seen.push(String(sql).replace(/\s+/g, ' ').trim()); return all(sql, ...args); };
    await matchdayView(w.service, params());
    for (const sql of seen) {
      assert.ok(!/^SELECT [^]*FROM football_cache$/i.test(sql), sql);
      assert.ok(!/^SELECT fixture_id,canonical_id FROM fixture_identities$/i.test(sql), sql);
      assert.ok(!/^SELECT provider_id,canonical_id FROM entity_aliases$/i.test(sql), sql);
      if (/FROM football_cache/i.test(sql)) assert.match(sql, /WHERE id(=| IN)/i);
    }
  } finally { w.sqlite.close(); }
});
