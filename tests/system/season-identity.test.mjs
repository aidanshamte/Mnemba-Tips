// Regression for the production live-worker failure
// "duplicate key value violates unique constraint seasons_competition_id_year_key":
// a provider labelling the same competition-year season with a different id must reuse the stored
// season instead of failing the whole discovery batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';

test('a second season id for the same competition and year reuses the stored season', async () => {
  const {store, sqlite} = database();
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const first = normalizeFixture('api-football', apiFixture(1201, 'NS', '2026-11-21T12:00:00Z'));
    await service.saveFixtures([first]);
    const year = first.competition.seasons.find(s => s.id === first.seasonId).year;
    // Same competition and year, different provider season label (e.g. "stage-…" vs "2026").
    const relabelled = `${first.competition.id}:stage-77`;
    const second = {...normalizeFixture('api-football', apiFixture(1202, 'NS', '2026-11-22T12:00:00Z', 30, 40)), seasonId: relabelled,
      competition: {...first.competition, seasons: [{id: relabelled, competitionId: first.competition.id, year, current: true, coverage: {}}]}};

    await service.saveFixtures([second]); // previously threw the unique-constraint violation
    const stored = await store.one('SELECT season_id FROM fixtures WHERE id=?', second.id);
    assert.equal(stored.season_id, first.seasonId);
    assert.equal(JSON.parse((await store.one('SELECT payload FROM fixtures WHERE id=?', second.id)).payload).seasonId, first.seasonId);
    assert.equal((await store.one('SELECT COUNT(*) n FROM seasons WHERE competition_id=? AND year=?', first.competition.id, year)).n, 1);
    assert.equal(await store.one('SELECT id FROM seasons WHERE id=?', relabelled), null);
    // Re-saving is idempotent.
    await service.saveFixtures([second]);
    assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures WHERE id=?', second.id)).n, 1);
  } finally { sqlite.close(); }
});

test('a genuinely different year still creates its own season', async () => {
  const {store, sqlite} = database();
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const first = normalizeFixture('api-football', apiFixture(1301, 'NS', '2026-11-21T12:00:00Z'));
    await service.saveFixtures([first]);
    const nextId = `${first.competition.id}:2027`;
    const later = {...normalizeFixture('api-football', apiFixture(1302, 'NS', '2027-08-01T12:00:00Z', 30, 40)), seasonId: nextId,
      competition: {...first.competition, seasons: [{id: nextId, competitionId: first.competition.id, year: 2027, current: true, coverage: {}}]}};
    await service.saveFixtures([later]);
    assert.equal((await store.one('SELECT season_id FROM fixtures WHERE id=?', later.id)).season_id, nextId);
  } finally { sqlite.close(); }
});
