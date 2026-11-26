// Shadow model: Gemini factors need evidence; snapshots only before kickoff; chronological fit recovers real effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {validateExplanation, factPack} from '../../lib/football/gemini-intelligence.mjs';
import {recordShadowSnapshot, shadowEvaluation, researchFeatures, tacticalScore} from '../../lib/football/shadow-model.mjs';

const F = {home: {name: 'Home FC'}, away: {name: 'Away FC'}, competition: {name: 'League'}};
const FC = {probabilities: [0.5, 0.3, 0.2], expectedGoals: [1.5, 1.0], factors: {homeForm: {games: 10, wins: 5, draws: 3, losses: 2}, awayForm: {games: 10, wins: 2, draws: 3, losses: 5}}};
const RESEARCH = {lineup: {status: 'predicted', home: {formation: '4-3-3'}, away: {formation: '3-5-2'}}, availability: [{team: 'away', player: 'Keeper One', status: 'injured', detail: 'goalkeeper, knee'}, {team: 'home', player: 'Mid Two', status: 'doubtful'}], verifiedAt: 1};

test('Gemini factors need cited evidence; unsupported factors are dropped; verdict defaults to insufficient', () => {
  const facts = factPack(F, FC, RESEARCH, {home: {rest: 6, last14: 2}, away: {rest: 3, last14: 4}});
  assert.ok(facts.some(f => f.id === 'away_absent' && f.value === 1) && facts.some(f => f.id === 'away_rest_days' && f.value === 3));
  const v = validateExplanation({points: [{text: 'Away FC report 1 injured player.', facts: ['away_absent']}], verdict: 'supports',
    factors: [{factor: 'goalkeeper', favours: 'home', strength: 2, facts: ['away_availability']}, {factor: 'tactics', favours: 'home', strength: 3, facts: []}, {factor: 'made_up', favours: 'home', strength: 1, facts: ['away_absent']}]}, facts);
  assert.deepEqual(v.factors.map(f => f.factor), ['goalkeeper']); assert.equal(v.verdict, 'supports');
  assert.equal(validateExplanation({points: [{text: 'Away FC report 1 injured player.', facts: ['away_absent']}]}, facts).verdict, 'insufficient');
  assert.equal(researchFeatures(RESEARCH).gkAbsentDiff, -1, 'away goalkeeper absent');
  assert.equal(tacticalScore([{factor: 'formation', favours: 'home', strength: 2}, {factor: 'rest', favours: 'away', strength: 3}]), 2, 'only tactical factors count');
});

test('snapshots are taken only before kickoff from the saved forecast; nothing changes production', async () => {
  const db = database(); let now = Date.parse('2026-11-27T10:00:00Z'); db.store.now = () => now; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize();
  try {
    const f = normalizeFixture('api-football', apiFixture(9990, 'NS', '2026-11-27T15:00:00Z', 10, 20)); await service.saveFixtures([f]);
    await db.store.run('INSERT INTO analysis_forecasts(id,fixture_id,model_version,as_of,kickoff_at,max_known_at,training_allowed,payload,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)', 'fc1', f.id, 'poisson-temporal-1', now - 3600000, f.startsAt, now - 7200000, 1, JSON.stringify(FC), '[]');
    const snap = await recordShadowSnapshot(service, f, RESEARCH);
    assert.equal(snap.latest.forecastId, 'fc1'); assert.equal(snap.latest.gkAbsentDiff, -1);
    now = f.startsAt + 60000; assert.equal(await recordShadowSnapshot(service, f, RESEARCH), null, 'no snapshot after kickoff');
    assert.equal((await shadowEvaluation(service)).state, 'collecting');
    assert.equal(JSON.parse((await db.store.one("SELECT payload FROM analysis_forecasts WHERE id='fc1'")).payload).probabilities[0], 0.5, 'forecast untouched');
  } finally { db.sqlite.close(); }
});

test('chronological evaluation recovers a real feature effect from earlier matches and scores it on later ones', async () => {
  // Synthetic, isolated data: home goal rate rises when the away goalkeeper is out.
  const rows = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const poisson = l => { let k = 0, p = Math.exp(-l), c = p; const u = rnd(); while (u > c && k < 10) { k++; p *= l / k; c += p; } return k; };
  const store = {all: async sql => sql.includes("LIKE 'shadow:%'") ? rows.map(r => ({id: 'shadow:' + r.id, payload: JSON.stringify({data: {latest: r.snap}})})) : [], one: async (sql, id) => rows.find(r => r.id === id)?.fx};
  for (let i = 0; i < 400; i++) {
    const gk = rnd() < 0.3 ? -1 : 0, lh = 1.4 * Math.exp(-0.3 * gk), la = 1.1 * Math.exp(0.3 * gk), hg = poisson(lh), ag = poisson(la);
    rows.push({id: 'm' + i, snap: {fixtureId: 'm' + i, kickoff: i, baseline: {probabilities: [0.45, 0.28, 0.27], expectedGoals: [1.4, 1.1]}, gkAbsentDiff: gk, absentDiff: 0, doubtfulDiff: 0, tacticalScore: 0, restDiff: 0, congestionDiff: 0, lineupStatus: 'confirmed'},
      fx: {status: 'FT', home_score: hg, away_score: ag}});
  }
  const ev = await shadowEvaluation({store});
  assert.equal(ev.state, 'evaluated'); assert.equal(ev.trainN, 200);
  assert.ok(ev.variants.lineup.beta.gkAbsentDiff < 0, 'effect sign recovered from the earlier half only');
  assert.ok(ev.variants.lineup.test.logLoss < ev.baseline.logLoss, 'scored on the later half');
  assert.equal(ev.production, 'unchanged until promotion criteria pass');
});
