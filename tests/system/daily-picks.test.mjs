// Every qualifying pick for the selected day (production: '151 matches · 5 top picks' came from a hard-coded
// .slice(0,5) in rankRecommendations and FEATURED_LIMIT=5 in the carousel, not from five qualifying matches).
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {featuredFixtures, featuredPool} from '../../lib/football/featured.mjs';
import {rankRecommendations} from '../../lib/football/recommendations.mjs';

const NOW = Date.parse('2026-11-28T08:00:00Z');
const rec = (rank, p = 0.7) => ({primary: {market: 'total', side: 'both', line: 1.5, selection: 'over', probabilities: {win: p}, support: 0.1}, alternatives: [], rank, sample: 12, ruleVersion: 'matchday-preference-2', forecastId: 'fc', createdAt: NOW - 3600000});
async function day(n, {extra = [], state = i => ({state: 'full', recommendation: rec(100 - i)})} = {}) {
  const w = database(); w.store.now = () => NOW; await w.store.init();
  const service = new IntelligenceService(w.store, {}); await service.initialize();
  const fx = Array.from({length: Math.max(n, 1) + 2}, (_, i) => normalizeFixture('api-football', apiFixture(6000 + i, 'NS', `2026-11-28T${String(10 + (i % 10)).padStart(2, '0')}:00:00Z`, 100 + i, 200 + i)));
  await service.saveFixtures([...fx, ...extra]);
  for (let i = 0; i < fx.length; i++) await w.store.putCache(`analysis:${fx[i].id}`, i < n ? state(i) : {state: i % 2 ? 'waiting' : 'provisional', recommendation: null}, 864e5);
  w.store.readOnly = true;
  const md = await service.read(new URLSearchParams({view: 'matchday', from: '2026-11-28', to: '2026-11-28', timezone: 'UTC'}));
  return {w, md, fx};
}

for (const n of [0, 1, 5, 6, 40]) test(`${n} qualifying matches: all ${n} returned, counted and reachable in the carousel`, async () => {
  const {w, md} = await day(n);
  try {
    assert.equal(md.picks.length, n); assert.equal(md.picksTotal, n); assert.equal(md.summary.qualifying, n);
    assert.equal(md.summary.fixtures, md.count);
    assert.equal(featuredFixtures(featuredPool(md)).length, n, 'carousel reaches every pick, including the sixth and later');
    if (!n) assert.match(md.note, /No qualifying picks yet/);
    for (const p of md.picks) { assert.ok(p.recommendation.primary); assert.equal(p.phase, 'upcoming'); assert.equal('analysis' in p, false, 'no per-pick model work or archive in the visitor path'); }
  } finally { w.sqlite.close(); }
});

test('summary separates analysed, qualifying, awaiting analysis and not qualifying', async () => {
  const {w, md} = await day(6);
  try {
    const s = md.summary;
    assert.equal(s.qualifying, 6); assert.equal(s.analysed + s.awaitingAnalysis, s.awaitingKickoff);
    assert.equal(s.notQualifying, s.analysed - s.qualifying); assert.ok(s.awaitingAnalysis >= 1);
  } finally { w.sqlite.close(); }
});

test('favourite leagues reorder but never hide picks', () => {
  const pool = Array.from({length: 9}, (_, i) => ({id: 'f' + i, competitionCanonical: i < 6 ? 'competition:x:big' : 'competition:x:small'}));
  const fav = featuredFixtures(pool, ['competition:x:small']);
  assert.equal(fav.length, 9); assert.equal(fav[0].competitionCanonical, 'competition:x:small');
});

test('started matches keep the pick published before kickoff, marked in play / finished; never re-created', async () => {
  const {w, md, fx} = await day(3);
  try {
    // Publish today's picks (as the visitor-independent scheduled path would), then move past two kickoffs.
    w.store.readOnly = false; const service = new IntelligenceService(w.store, {});
    await service.read(new URLSearchParams({view: 'matchday', from: '2026-11-28', to: '2026-11-28', timezone: 'UTC'}));
    const listed = await w.store.all('SELECT published_at FROM recommendation_lists');
    assert.equal(listed.length, 1, 'published once');
    w.store.now = () => Date.parse('2026-11-28T12:30:00Z');
    await service.saveFixtures([normalizeFixture('api-football', apiFixture(6000, 'FT', '2026-11-28T10:00:00Z', 100, 200)), normalizeFixture('api-football', apiFixture(6001, '2H', '2026-11-28T11:00:00Z', 101, 201))]);
    await w.store.run("DELETE FROM football_cache WHERE id LIKE 'matchday:%'");
    w.store.readOnly = true;
    const later = await service.read(new URLSearchParams({view: 'matchday', from: '2026-11-28', to: '2026-11-28', timezone: 'UTC'}));
    const byId = new Map(later.picks.map(p => [p.fixture.id, p]));
    assert.equal(byId.get(fx[0].id)?.phase, 'finished'); assert.equal(byId.get(fx[1].id)?.phase, 'in-play');
    assert.ok(byId.get(fx[0].id).savedAt < fx[0].startsAt, 'shown with its pre-kickoff publication time');
    assert.equal(later.picks.filter(p => p.phase === 'upcoming').length, 1);
    assert.equal(later.picks[0].phase, 'upcoming', 'upcoming picks first, started ones after');
  } finally { w.sqlite.close(); }
});

test('provider copies of one match count once; every distinct match is kept', () => {
  const e = (id, canonicalId, rank) => ({fixture: {id, canonicalId}, recommendation: {primary: {market: 'btts'}, rank}});
  const ranked = rankRecommendations([e('api-football:1', 'c1', 50), e('fivedollar:9', 'c1', 60), ...Array.from({length: 8}, (_, i) => e('x:' + i, 'k' + i, i))]);
  assert.equal(ranked.length, 9); assert.equal(ranked.filter(x => x.fixture.canonicalId === 'c1').length, 1);
});

test('the scheduled analysis-states stage publishes the day\'s full collection without any visitor', async () => {
  const {w, fx} = await day(7);
  try {
    w.store.readOnly = false; const service = new IntelligenceService(w.store, {}); await service.initialize();
    const r = await service.sync('analysis-states');
    const today = r.published?.find(p => p.day === '2026-11-28');
    assert.ok(today && !today.error, JSON.stringify(r.published));
    w.store.readOnly = true;
    const md = await service.read(new URLSearchParams({view: 'matchday', from: '2026-11-28', to: '2026-11-28', timezone: 'UTC'}));
    assert.equal(today.picks, md.picksTotal, 'the stage publishes exactly the collection visitors see');
    if (md.picksTotal) { const rows = await w.store.all('SELECT payload FROM recommendation_lists'); assert.equal(JSON.parse(rows.at(-1).payload).selection.length, md.picks.filter(p => p.phase === 'upcoming').length, 'every upcoming pick is published, uncapped'); }
    assert.ok(fx.length > 7);
  } finally { w.sqlite.close(); }
});
