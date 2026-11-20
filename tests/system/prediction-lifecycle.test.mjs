// End-to-end prediction lifecycle, in order, on an isolated in-memory database:
// upcoming fixture → evidence → forecast → immutable pre-kickoff storage → live retention →
// final result → grading → measured performance. Plus settlement, void/withheld states,
// exploratory separation and candidate promotion guards. Nothing here touches production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';
import {archiveFor} from '../../lib/football/forecast-history.mjs';
import {settleMarket} from '../../lib/football/market-registry.mjs';

async function world(start = '2026-09-10T12:00:00Z') {
  const db = database(); let now = Date.parse(start); db.store.now = () => now;
  await db.store.init(); const service = new IntelligenceService(db.store); await service.initialize();
  // Evidence: earlier completed meetings that the model may use (all before the cutoff).
  await service.saveFixtures([1, 2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(700 + i, 'FT', `2026-09-0${i}T12:00:00Z`))));
  return {...db, service, lab: new ModelLab(service), at: t => { now = typeof t === 'number' ? t : Date.parse(t); }, now: () => now};
}
const forecasts = (store, id) => store.all('SELECT id,as_of,kickoff_at,payload FROM analysis_forecasts WHERE fixture_id=?', id);

test('upcoming → stored once before kickoff → frozen while live → graded on the confirmed result', async () => {
  const w = await world();
  try {
    const f = normalizeFixture('api-football', apiFixture(710, 'NS', '2026-09-11T12:00:00Z'));
    await w.service.saveFixtures([f]);

    // Eligible upcoming fixture creates the stored forecasts (one per tracked model version).
    const first = await w.lab.capture(f);
    assert.ok(first.forecasts > 0, 'forecast created');
    const stored = await forecasts(w.store, f.id);
    assert.equal(stored.length, first.forecasts);
    for (const r of stored) assert.ok(r.as_of < r.kickoff_at, 'saved before kickoff');

    // Repeated scheduled jobs do not duplicate it.
    assert.equal((await w.lab.capture(f)).state, 'cached');
    assert.equal((await forecasts(w.store, f.id)).length, stored.length);

    // Stored forecasts are immutable (no rewrite, no backdating of as_of).
    await assert.rejects(w.store.run("UPDATE analysis_forecasts SET payload='{}'"), /immutable/);
    await assert.rejects(w.store.run('UPDATE analysis_forecasts SET as_of=as_of-86400000'), /immutable/);

    // After kickoff no new forecast can be created (no post-kickoff "prediction").
    w.at(f.startsAt + 60_000);
    await w.service.saveFixtures([{...f, status: '1H', homeScore: 0, awayScore: 0}]);
    assert.notEqual((await w.lab.capture({...f, status: '1H'})).forecasts > 0, true);
    assert.equal((await forecasts(w.store, f.id)).length, stored.length);
    // Live match retains the original forecast, ungraded.
    const live = await archiveFor(w.service, f);
    assert.equal(live.original.id, stored.find(r => r.id === live.original.id)?.id);
    assert.equal(await w.lab.grade(), 0);
    assert.equal((await w.lab.performance()).versions[0].count, 0);

    // Final result: graded against the original (pre-kickoff) version; payload unchanged.
    w.at(f.startsAt + 3 * 3600_000);
    await w.service.saveFixtures([{...f, status: 'FT', homeScore: 2, awayScore: 1}]);
    await w.lab.grade();
    const done = await archiveFor(w.service, f);
    assert.equal(done.original.id, live.original.id);
    assert.equal(done.selected.gradeState, 'graded');
    assert.equal(done.selected.grade.homeScore, 2);
    const after = await forecasts(w.store, f.id);
    assert.deepEqual(after.map(r => r.payload).sort(), stored.map(r => r.payload).sort(), 'result updates never overwrite the forecast');

    // Performance counts only forecasts genuinely saved before kickoff.
    const perf = await w.lab.performance();
    assert.equal(perf.versions[0].count, 1);
    assert.match(perf.note, /Prospective immutable forecasts only/);
  } finally { w.sqlite.close(); }
});

test('postponed and abandoned matches are withheld, cancelled or rescheduled ones are void, none count as accuracy', async () => {
  for (const [status, expected, shift] of [['PST', 'withheld', 0], ['ABD', 'withheld', 0], ['CANC', 'void', 0], ['PST', 'void', 86400000]]) {
    const w = await world();
    try {
      const f = normalizeFixture('api-football', apiFixture(720, 'NS', '2026-09-11T12:00:00Z'));
      await w.service.saveFixtures([f]); await w.lab.capture(f);
      w.at(f.startsAt + 3600_000);
      await w.service.saveFixtures([{...f, status, startsAt: f.startsAt + shift}]);
      await w.lab.grade();
      assert.equal((await archiveFor(w.service, f)).selected.gradeState, expected, `${status}+${shift}`);
      assert.equal((await w.lab.performance()).versions[0].count, 0, `${status} not counted`);
    } finally { w.sqlite.close(); }
  }
});

test('date-only kickoffs stay exploratory: no tracked forecast is stored', async () => {
  const w = await world();
  try {
    const f = normalizeFixture('api-football', apiFixture(730, 'NS', '2026-09-11T12:00:00Z'));
    await w.service.saveFixtures([f]);
    assert.equal((await w.lab.capture({...f, kickoffPrecision: 'date'})).state, 'abstained');
    assert.equal((await forecasts(w.store, f.id)).length, 0);
  } finally { w.sqlite.close(); }
});

test('market settlement: wins, losses, pushes and voids', () => {
  assert.equal(settleMarket({market: 'result', selection: 'home'}, 2, 1), 'win');
  assert.equal(settleMarket({market: 'result', selection: 'away'}, 2, 1), 'loss');
  assert.equal(settleMarket({market: 'draw-no-bet', selection: 'home'}, 1, 1), 'push');
  assert.equal(settleMarket({market: 'total', selection: 'over', line: 2}, 1, 1), 'push');
  assert.equal(settleMarket({market: 'total', selection: 'over', line: 2.5}, 2, 1), 'win');
  assert.equal(settleMarket({market: 'btts', selection: 'yes'}, 2, 0), 'loss');
  assert.equal(settleMarket({market: 'result', selection: 'home'}, null, null, {status: 'CANC'}), 'void');
  assert.equal(settleMarket({market: 'result', selection: 'home'}, 1, 0, {status: '1H'}), 'pending');
  assert.equal(settleMarket({market: 'result', selection: 'home'}, 1, 0, {period: 'extra-time'}), 'pending');
});

test('the models stage stops before the scheduler deadline, keeps its cursor, still grades, then resumes', async () => {
  const w = await world();
  try {
    const upcoming = [0, 1, 2].map(i => normalizeFixture('api-football', apiFixture(750 + i, 'NS', `2026-09-1${1 + i}T12:00:00Z`)));
    await w.service.saveFixtures(upcoming);
    const stopped = await w.lab.update({stopAt: w.now()});
    assert.equal(stopped.stoppedEarly, true);
    assert.equal(stopped.complete, false, 'batch stays resumable');
    assert.equal(stopped.processed, 0);
    assert.equal(typeof stopped.graded, 'number', 'grading still runs after an early stop');
    const resumed = await w.lab.update({stopAt: w.now() + 3600_000});
    assert.equal(resumed.stoppedEarly, false);
    assert.equal(resumed.complete, true);
    assert.ok(resumed.processed >= upcoming.length);
    for (const f of upcoming) assert.ok((await forecasts(w.store, f.id)).length > 0, `forecast stored for ${f.id}`);
  } finally { w.sqlite.close(); }
});

test('a model candidate is never promoted from one match or a training fit', async () => {
  const w = await world();
  try {
    const f = normalizeFixture('api-football', apiFixture(740, 'NS', '2026-09-11T12:00:00Z'));
    await w.service.saveFixtures([f]); await w.lab.capture(f);
    w.at(f.startsAt + 3 * 3600_000);
    await w.service.saveFixtures([{...f, status: 'FT', homeScore: 3, awayScore: 0}]); await w.lab.grade();
    const decision = await w.lab.evaluateCandidate();
    assert.equal(decision.state, 'collecting');
    assert.equal(decision.required, 200);
    assert.ok(decision.paired <= 1);
    assert.equal(await w.store.one("SELECT 1 FROM model_release_decisions WHERE state='promoted'"), null);
    const runtime = await w.store.one("SELECT model_version FROM model_runtime WHERE id='primary'");
    assert.notEqual(runtime?.model_version, 'dc-candidate-1');
  } finally { w.sqlite.close(); }
});
