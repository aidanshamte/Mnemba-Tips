// Completion pass: abandoned status, abandonment settlement, capture memo, sibling logo choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeLiveScore} from '../../lib/football/livescore.mjs';
import {classifyBoard} from '../../lib/football/live-board.mjs';
import {settleAbandoned, gradeLive} from '../../lib/football/live-grading.mjs';
import {inplayMarkets, remainingTime} from '../../lib/football/inplay.mjs';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';
import {saveMedia} from '../../lib/football/media-registry.mjs';
import {visualCatalog} from '../../lib/football/visuals.mjs';

const NOW = Date.parse('2026-11-26T12:00:00Z'), L = [1.4, 1.1];

test("LiveScore 'Aband.' (Esid 17, sanitized provider response) is abandoned, not live; unknown values stay isolated", () => {
  const board = JSON.parse(readFileSync(new URL('../fixtures/livescore/scoreboard.json', import.meta.url)));
  const f = normalizeLiveScore({...board, Eps: 'Aband.', Esid: 17}, board.Stg, {compactTimestampTimezone: 'UTC'});
  assert.equal(f.status, 'ABD');
  const b = classifyBoard([{...f, startsAt: NOW - 3600000, observedAt: NOW}], NOW, {lastUpdate: NOW});
  assert.deepEqual([b.live.length, b.delayed.length, b.finished.length], [0, 0, 0], 'not shown as playing or finished');
  assert.throws(() => normalizeLiveScore({...board, Eps: 'Weird', Esid: 99}, board.Stg, {compactTimestampTimezone: 'UTC'}), e => e.name === 'LiveScoreRecordError', 'never guessed as finished');
});

test('abandonment settlement: decided outcomes stand, the rest is void, per market', () => {
  const markets = inplayMarkets({home: 1, away: 1, lambda: L, mixture: remainingTime('2H', 60).mixture});
  const fx = {id: 'x', home: {id: 'h', name: 'H'}, away: {id: 'a', name: 'A'}};
  const s = settleAbandoned({input: {home: 1, away: 1, status: '2H', elapsed: 60}, markets}, {home: 2, away: 1}, null, fx);
  assert.equal(s.result.state, 'void'); assert.equal(s.doubleChance.state, 'void');
  assert.equal(s.totals.find(t => t.line === 2.5).outcome, 'over', 'line already exceeded stands');
  assert.equal(s.totals.find(t => t.line === 3.5).state, 'void');
  assert.equal(s.anotherGoal.outcome, true); assert.equal(s.nextGoal.state, 'unresolved', 'no complete sequence, no guess');
  const none = settleAbandoned({input: {home: 1, away: 1}, markets}, {home: 1, away: 1}, null, fx);
  assert.equal(none.anotherGoal.state, 'void'); assert.equal(none.nextGoal.state, 'void');
  assert.equal(settleAbandoned({input: {home: 0, away: 0}, markets}, {home: null, away: null}, null, fx).result.state, 'void');
});

test('gradeLive marks abandoned matches once, without duplicate rows', async () => {
  const db = database(); db.store.now = () => NOW; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  try {
    const f = {...normalizeFixture('api-football', apiFixture(7101, 'ABD', '2026-11-26T10:00:00Z', 10, 20)), homeScore: 2, awayScore: 1};
    await service.saveFixtures([f]);
    const markets = inplayMarkets({home: 1, away: 1, lambda: L, mixture: remainingTime('2H', 60).mixture});
    await db.store.run('INSERT INTO live_snapshots(id,fixture_id,canonical_id,model_version,created_at,observed_at,minute,payload) VALUES(?,?,?,?,?,?,?,?)', 'sa', f.id, null, 'inplay-poisson-1', NOW - 7000000, NOW - 7000000, 60, JSON.stringify({input: {home: 1, away: 1, status: '2H', elapsed: 60}, markets}));
    await gradeLive(service); await gradeLive(service);
    const rows = await db.store.all('SELECT state,payload FROM live_grades');
    assert.equal(rows.length, 1); assert.equal(rows[0].state, 'abandoned'); assert.equal(JSON.parse(rows[0].payload).result.state, 'void');
  } finally { db.sqlite.close(); }
});

async function captureWorld() {
  const db = database(); db.store.now = () => Date.parse('2026-11-25T10:00:00Z'); await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  const past = []; for (let i = 1; i <= 5; i++) past.push(normalizeFixture('api-football', apiFixture(8300 + i, 'FT', `2026-10-0${i}T15:00:00Z`, 10, 20)), normalizeFixture('api-football', apiFixture(8400 + i, 'FT', `2026-10-0${i}T18:00:00Z`, 20, 10)));
  await service.saveFixtures(past);
  const a = normalizeFixture('api-football', apiFixture(8501, 'NS', '2026-11-25T18:00:00Z', 10, 20)), b = normalizeFixture('api-football', apiFixture(8502, 'NS', '2026-11-25T19:00:00Z', 20, 10));
  await service.saveFixtures([a, b]);
  return {db, service, a, b};
}
const forecastOf = async (db, id) => JSON.parse((await db.store.one("SELECT payload FROM analysis_forecasts WHERE fixture_id=? AND model_version='poisson-temporal-1'", id)).payload);

test('capture loads the claim history once per run and gives the same forecast as a fresh load', async () => {
  const one = await captureWorld(), two = await captureWorld();
  try {
    let fullLoads = 0; const all = one.db.store.all.bind(one.db.store);
    one.db.store.all = (sql, ...args) => { if (/FROM field_claims c WHERE c.field='fixture' AND c.known_at/.test(sql)) fullLoads++; return all(sql, ...args); };
    const lab = new ModelLab(one.service);
    assert.equal((await lab.capture(one.a)).state, 'captured'); assert.equal((await lab.capture(one.b)).state, 'captured');
    assert.equal(fullLoads, 1, 'history loaded once for both captures');
    assert.equal((await new ModelLab(two.service).capture(two.b)).state, 'captured');
    const memo = await forecastOf(one.db, one.b.id), fresh = await forecastOf(two.db, two.b.id);
    assert.deepEqual(memo.probabilities, fresh.probabilities); assert.deepEqual(memo.expectedGoals, fresh.expectedGoals);
  } finally { one.db.sqlite.close(); two.db.sqlite.close(); }
});

test('verified siblings with different logo files resolve deterministically; unverified aliases never take part', async () => {
  const {store, sqlite} = database();
  try {
    await store.init();
    const m = u => ({url: `https://upload.wikimedia.org/${u}.png`, sourceUrl: `https://commons.wikimedia.org/wiki/File:${u}.png`, usageBasis: 'CC BY 4.0', attribution: 'Creator', lastSuccess: store.now()});
    await saveMedia(store, {id: 'comp:a', type: 'competition'}, 'badge', m('league-2023'), 'Exact identity');
    await saveMedia(store, {id: 'comp:b', type: 'competition'}, 'badge', m('league-2024'), 'Exact identity');
    await saveMedia(store, {id: 'comp:c', type: 'competition'}, 'badge', m('league-2024'), 'Exact identity');
    await store.upsert('canonical_entities', {id: 'competition:x', kind: 'competition', name: 'League', payload: '{}', updated_at: store.now()});
    for (const [id, verified] of [['comp:a', 1], ['comp:b', 1], ['comp:c', 1], ['comp:new', 1], ['comp:guess', 0]]) await store.upsert('entity_aliases', {id, canonical_id: 'competition:x', provider: id, provider_id: id, alias: 'League', normalized_alias: 'league', verified});
    const cat = await visualCatalog(store);
    assert.match(cat.competition['comp:new'].logoUrl, /league-2024/, 'the file most verified siblings use');
    assert.equal(cat.competition['comp:guess'], undefined);
    assert.match(cat.competition['comp:a'].logoUrl, /league-2023/, 'a direct logo is never replaced');
  } finally { sqlite.close(); }
});
