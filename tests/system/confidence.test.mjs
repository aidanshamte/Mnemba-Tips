// Display confidence: measured probability bands, capped by evidence; never above what the data supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPick, CONFIDENCE_BANDS} from '../../lib/football/confidence.mjs';

const F = {home: {name: 'Alpha'}, away: {name: 'Bravo'}};
const form = g => ({homeForm: {games: g}, awayForm: {games: 10}});

test('pick, probability and tier come from the match-result probabilities and measured bands', () => {
  assert.deepEqual(CONFIDENCE_BANDS, {high: 0.65, moderate: 0.55, minGames: 5});
  const hi = matchPick({probabilities: [0.7, 0.2, 0.1], factors: form(10), estimateKind: 'tracked'}, F);
  assert.equal(hi.pick, 'Alpha win'); assert.equal(hi.tier, 'high'); assert.equal(hi.label, 'High confidence');
  assert.equal(matchPick({probabilities: [0.2, 0.2, 0.6], factors: form(10)}, F).pick, 'Bravo win');
  assert.equal(matchPick({probabilities: [0.2, 0.2, 0.6], factors: form(10)}, F).tier, 'moderate');
  assert.equal(matchPick({probabilities: [0.3, 0.4, 0.3], factors: form(10)}, F).pick, 'Draw');
  assert.equal(matchPick({probabilities: [0.48, 0.27, 0.25], factors: form(10)}, F).tier, 'low');
});

test('early estimates are at most low; thin evidence is insufficient; no probabilities is no pick', () => {
  assert.equal(matchPick({probabilities: [0.8, 0.1, 0.1], factors: form(10), estimateKind: 'provisional'}, F).tier, 'low');
  assert.equal(matchPick({probabilities: [0.8, 0.1, 0.1], factors: form(3)}, F).tier, 'insufficient');
  assert.equal(matchPick({probabilities: [0.8, 0.1, 0.1], factors: form(3)}, F).label, 'Insufficient data');
  assert.equal(matchPick({}, F), null); assert.equal(matchPick({probabilities: [0.5, NaN, 0.5]}, F), null);
});
