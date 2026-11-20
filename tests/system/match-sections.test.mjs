// Match centre data sections: rendered from stored data when present, reported as unavailable
// (with a reason) when genuinely missing. Deterministic in-memory fixtures; nothing is fabricated in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';

async function setup() {
  const {store, sqlite} = database(); await store.init();
  const service = new IntelligenceService(store); await service.initialize();
  const earlier = normalizeFixture('api-football', apiFixture(930, 'FT', '2025-01-01T12:00:00Z'));
  const fixture = normalizeFixture('api-football', apiFixture(931, 'FT', '2025-02-01T12:00:00Z'));
  await service.saveFixtures([earlier, fixture]);
  return {store, sqlite, service, fixture};
}
const read = (service, id) => service.read(new URLSearchParams({view: 'match-context', id}));
const byName = (context, name) => context.coverage.find(c => c.name === name);

test('populated match: lineups, events, statistics, availability, form, head-to-head, table and related reporting', async () => {
  const {sqlite, service, store, fixture} = await setup();
  try {
    await service.detailRecord('lineups', fixture, [{team: fixture.home, formation: '4-3-3', startXI: [{player: {name: 'Recorded Keeper', number: 1}}]}]);
    await service.detailRecord('fixture_events', fixture, [{team: fixture.home, time: {elapsed: 12}, player: {name: 'Recorded Scorer'}, type: 'Goal', detail: 'Normal Goal'}]);
    await service.detailRecord('fixture_statistics', fixture, [{team: fixture.home, statistics: [{type: 'Shots on Goal', value: 5}]}]);
    await service.detailRecord('injuries', fixture, [{team: fixture.away, player: {name: 'Recorded Absentee', reason: 'Knee injury'}}]);
    const article = {id: 'news:test-1', url: 'https://example.org/team-10', headline: 'Team 10 prepare for the visit of Team 20', summary: 'Preview.', publisher: 'Example', publishedAt: Date.parse('2025-01-30T09:00:00Z'), category: 'preview'};
    await store.upsert('news_articles', {id: article.id, canonical_url: article.url, headline: article.headline, publisher: article.publisher, published_at: article.publishedAt, category: article.category, payload: JSON.stringify(article), updated_at: article.publishedAt});

    const context = await read(service, fixture.id);
    for (const [table, n] of [['lineups', 1], ['fixture_events', 1], ['fixture_statistics', 1], ['injuries', 1]]) assert.equal(context.details[table].length, n, table);
    for (const name of ['Team sheets', 'Availability', 'Events', 'Statistics', 'Head-to-head']) assert.equal(byName(context, name).available, true, name);
    assert.equal(context.h2h.games, 1);
    assert.equal(context.form[0].overall.games, 1);
    assert.ok(context.table.rows.length > 0);
    assert.equal(context.news.length, 1);
    assert.match(context.news[0].association, /not confirmation/);
  } finally { sqlite.close(); }
});

test('unavailable match data is reported with a reason, never filled with placeholder rows', async () => {
  const {sqlite, service, fixture} = await setup();
  try {
    const context = await read(service, fixture.id);
    for (const table of ['lineups', 'fixture_events', 'fixture_statistics', 'injuries']) assert.deepEqual(context.details[table], [], table);
    for (const name of ['Team sheets', 'Availability', 'Events', 'Statistics']) {
      const c = byName(context, name); assert.equal(c.available, false, name); assert.ok(c.reason && c.reason.length > 10, name);
    }
    assert.deepEqual(context.news, []);
    assert.ok(context.probableLineups.every(r => r.players.length === 0));
  } finally { sqlite.close(); }
});

test('an unknown match stays unavailable and gains no related reporting', async () => {
  const {sqlite, service} = await setup();
  try { assert.deepEqual(await read(service, 'api-football:does-not-exist'), {unavailable: true}); } finally { sqlite.close(); }
});
