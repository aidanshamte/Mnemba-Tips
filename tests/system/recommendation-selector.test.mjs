// Selection rule v2: any supported market, eligibility first, then support above a neutral prior; not the largest
// home/draw/away probability. Abstains clearly; never selects for started, stale or conflicting matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {apiFixture} from '../football-db.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {decideRecommendation, RULE_VERSION} from '../../lib/football/recommendations.mjs';
import {pickLabel} from '../../lib/football/pick-label.mjs';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const f = normalizeFixture('api-football', apiFixture(5100, 'NS', '2026-09-11T15:00:00Z', 11, 12));
const analysis = (lambda, mu, extra = {}) => ({probabilities: [0.4, 0.3, 0.3], expectedGoals: [lambda, mu], factors: {home: {games: 20, restDays: 5}, away: {games: 20, restDays: 6}}, asOf: NOW - 60000, modelVersion: 'poisson-temporal-1', archive: {selected: {id: 'fc-1'}}, ...extra});

test('a qualifying goals market leads when no result outcome reaches the band', () => {
  const r = decideRecommendation(f, analysis(1.75, 1.45), NOW);   // open match, many goals: no 1X2 outcome >= 60%
  assert.ok(r.primary, r.reason);
  assert.notEqual(r.primary.market, 'result', 'the largest 1X2 probability is not automatically the pick');
  assert.ok(r.primary.probabilities.win >= 0.6 && r.primary.probabilities.win <= 0.85);
  assert.equal(r.ruleVersion, RULE_VERSION); assert.equal(r.forecastId, 'fc-1'); assert.ok(r.createdAt);
  assert.match(pickLabel(r.primary, f), /goals|score|or draw|to win/);
});

test('ranking is by support above the neutral prior; alternatives are non-redundant (<= 2, distinct families)', () => {
  const r = decideRecommendation(f, analysis(2.3, 0.6), NOW);
  assert.ok(r.primary); const all = [r.primary, ...r.alternatives];
  assert.ok(r.alternatives.length <= 2);
  const fam = o => o.market === 'double-chance' ? 'result' : o.market === 'total' ? 'total' : o.market;
  assert.equal(new Set(all.map(fam)).size, all.length, 'one option per market family');
  for (const o of r.alternatives) assert.ok(o.support <= r.primary.support);
  assert.equal(all.some(o => o.market === 'draw-no-bet'), false);
});

test('no qualifying market: a clear abstention, fixture unaffected', () => {
  const r = decideRecommendation(f, analysis(1.4, 1.1), NOW);   // the neutral prior itself: nothing above it
  assert.equal(r.primary, null); assert.equal(r.decision, 'No strong selection'); assert.ok(r.reason);
});

test('stale, started and conflicting inputs never produce a selection', () => {
  assert.equal(decideRecommendation(f, analysis(2.3, 0.6, {needsRefresh: true}), NOW).primary, null);
  const live = {...f, status: '1H', startsAt: NOW - 1800000};
  assert.equal(decideRecommendation(live, analysis(2.3, 0.6), NOW).primary, null, 'in-play: already-started markets are not offered');
  assert.equal(decideRecommendation({...f, hasConflict: true}, analysis(2.3, 0.6), NOW).primary, null);
  const thin = analysis(2.3, 0.6, {factors: {home: {games: 3, restDays: 5}, away: {games: 20, restDays: 5}}});
  assert.equal(decideRecommendation(f, thin, NOW).primary, null, 'insufficient evidence');
});
