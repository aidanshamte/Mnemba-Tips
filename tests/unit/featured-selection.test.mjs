// Regression: the homepage hero and browser smoke test must distinguish "no eligible featured
// fixture" (legitimate, recorded skip) from an application failure, without inventing fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFeatured, featuredFixtures, featuredPool} from '../../lib/football/featured.mjs';

const range = {from: '2026-11-20', to: '2026-11-20'};
const fx = id => ({id, home: {id: 'h' + id, name: 'Home ' + id}, away: {id: 'a' + id, name: 'Away ' + id}, startsAt: 0, status: 'NS'});

test('a matchday with no fixtures is classified as none, not as a failure', () => {
  const r = classifyFeatured(200, {range, fixtures: [], picks: []});
  assert.equal(r.state, 'none'); assert.equal(r.count, 0); assert.deepEqual(r.ids, []); assert.deepEqual(r.range, range);
});

test('application failures throw instead of being reported as an empty matchday', () => {
  assert.throws(() => classifyFeatured(500, {error: 'boom'}), /HTTP 500/);
  assert.throws(() => classifyFeatured(404, null), /HTTP 404/);
  assert.throws(() => classifyFeatured(200, null), /malformed/);
  assert.throws(() => classifyFeatured(200, {fixtures: []}), /malformed/);
  assert.throws(() => classifyFeatured(200, {range, error: 'Matchday unavailable'}), /malformed/);
});

const pick = id => ({fixture: fx(id), recommendation: {primary: {market: 'btts', selection: 'yes', probabilities: {win: 0.7}}}});
test('only qualifying picks are featured: fixtures without a pick never stand in for picks', () => {
  assert.equal(classifyFeatured(200, {range, fixtures: [fx(1), fx(2)], picks: []}).state, 'none');
  assert.equal(classifyFeatured(200, {range, fixtures: [fx(1)], picks: [pick(1)]}).state, 'single');
  assert.equal(classifyFeatured(200, {range, fixtures: [fx(1), fx(2)], picks: [pick(1), pick(2)]}).state, 'carousel');
});

test('stored picks take precedence over raw fixtures and carry their recommendation', () => {
  const body = {range, fixtures: [fx(1), fx(2), fx(3)], picks: [{fixture: fx(3), recommendation: {primary: {label: 'Home', probabilities: {win: 0.62}}}}]};
  const pool = featuredPool(body);
  assert.deepEqual(pool.map(f => f.id), [3]); assert.equal(pool[0].recommendation.primary.label, 'Home');
  const r = classifyFeatured(200, body);
  assert.equal(r.state, 'single'); assert.equal(r.probabilities, 1);
});

test('duplicates are removed and nothing is capped: 0, 1, 5, 6 and many picks all stay reachable', () => {
  const list = featuredFixtures([fx(1), fx(1), fx(2), fx(3), fx(4), fx(5), fx(6), fx(7)]);
  assert.deepEqual(list.map(f => f.id), [1, 2, 3, 4, 5, 6, 7], 'the sixth and seventh are kept');
  for (const n of [0, 1, 5, 6, 40]) assert.equal(featuredFixtures(Array.from({length: n}, (_, i) => fx(i + 1))).length, n);
  const started = featuredFixtures([{...fx(1), phase: 'finished'}, fx(2)]); assert.deepEqual(started.map(f => f.id), [2, 1], 'upcoming picks before started ones');
  assert.deepEqual(featuredFixtures([fx(1), {name: 'no id'}]).map(f => f.id), [1]);
  assert.deepEqual(featuredFixtures(undefined), []);
});

test('classification never depends on the wall-clock date', () => {
  const body = {range: {from: '2031-02-29', to: '2031-02-29'}, fixtures: [fx(9), fx(8)], picks: [pick(9), pick(8)]};
  assert.deepEqual(classifyFeatured(200, body), {state: 'carousel', count: 2, range: body.range, probabilities: 2, ids: [9, 8]});
});
