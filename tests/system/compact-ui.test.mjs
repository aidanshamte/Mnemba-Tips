// Compact UI release: featured-league ordering (presentation only), carousel diversity and the live status filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {competitionRank, orderByCompetition, FEATURED_COMPETITIONS, REGIONAL_COMPETITIONS} from '../../lib/football/featured-competitions.mjs';
import {featuredFixtures, featuredPool, FEATURED_LIMIT} from '../../lib/football/featured.mjs';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {matchdayView} from '../../lib/football/recommendations.mjs';

const PL = 'competition:england:premier-league', LALIGA = 'competition:spain:laliga', TZ = 'competition:tanzania:nbc-premier-league';

test('featured config: the seven defaults in order, no duplicates, regional list separate', () => {
  assert.deepEqual(FEATURED_COMPETITIONS.slice(0, 2), [PL, LALIGA]);
  assert.equal(FEATURED_COMPETITIONS.length, 7);
  const all = [...FEATURED_COMPETITIONS, ...REGIONAL_COMPETITIONS];
  assert.equal(new Set(all).size, all.length, 'no league listed twice');
  assert.ok(all.every(id => id.startsWith('competition:')), 'canonical ids only');
});

test('ordering: favourites, then featured, then regional, then the rest; nothing is removed; ties keep order', () => {
  const items = ['competition:x:one', TZ, LALIGA, 'competition:x:two', PL].map(id => ({id}));
  assert.deepEqual(orderByCompetition(items, i => i.id).map(i => i.id), [PL, LALIGA, TZ, 'competition:x:one', 'competition:x:two']);
  assert.deepEqual(orderByCompetition(items, i => i.id, ['competition:x:two']).map(i => i.id)[0], 'competition:x:two', 'a pin moves a league to the top');
  assert.equal(orderByCompetition(items, i => i.id, ['competition:x:two']).length, items.length, 'pins never filter');
  assert.deepEqual(competitionRank('competition:x:none'), [3, 0]);
});

test('carousel: favourite/featured leagues first, at most two per league while others exist, no duplicates', () => {
  const fx = (id, league) => ({id, competitionCanonical: league, competition: {id: league, name: league}});
  const pool = [fx('a', TZ), fx('b', PL), fx('c', PL), fx('d', PL), fx('e', 'competition:x:one'), fx('b', PL), fx('f', LALIGA)];
  const out = featuredFixtures(pool);
  assert.deepEqual(out.map(f => f.id), ['b', 'c', 'f', 'a', 'e']);
  assert.equal(out.length, FEATURED_LIMIT);
  assert.equal(featuredFixtures(pool, ['competition:x:one'])[0].id, 'e');
  // With only one league available the carousel still fills up.
  assert.equal(featuredFixtures([fx('1', PL), fx('2', PL), fx('3', PL)]).length, 3);
  // Picks take their canonical league from the matchday fixture list.
  const pooled = featuredPool({picks: [{fixture: {id: 'b'}, recommendation: {}}], fixtures: [fx('b', PL)]});
  assert.equal(pooled[0].competitionCanonical, PL);
});

test('live status filter returns only in-play fixtures and leaves probabilities untouched', async () => {
  const db = database(); const now = Date.parse('2026-11-05T12:30:00Z'); db.store.now = () => now;
  await db.store.init(); const service = new IntelligenceService(db.store); await service.initialize();
  try {
    await service.saveFixtures([normalizeFixture('api-football', apiFixture(3001, '1H', '2026-11-05T12:00:00Z', 10, 20)), normalizeFixture('api-football', apiFixture(3002, 'NS', '2026-11-05T18:00:00Z', 30, 40))]);
    const params = extra => new URLSearchParams({day: 'date', from: '2026-11-05', timezone: 'UTC', ...extra});
    const all = await matchdayView(service, params({}));
    const live = await matchdayView(service, params({status: 'live'}));
    assert.ok(all.fixtures.length >= 2);
    assert.deepEqual(live.fixtures.map(f => f.status), ['1H']);
    const ids = new Set(all.fixtures.map(f => f.id)); assert.equal(ids.size, all.fixtures.length, 'no duplicate fixtures');
    const before = all.fixtures.find(f => f.status === '1H'), after = live.fixtures[0];
    assert.deepEqual(after.analysis?.probabilities ?? null, before.analysis?.probabilities ?? null, 'filtering never changes probabilities');
  } finally { db.sqlite.close(); }
});
