// Confirmed team sheets from another provider's record of the same match; never from other matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {lineupContext, siblingLineups, normalizeLineups} from '../../lib/football/probable-lineup.mjs';
import {matchContext} from '../../lib/football/consumer.mjs';

const XI = side => Array.from({length: 11}, (_, i) => ({id: `livescore:p${side}${i}`, name: `Player ${side}${i}`, jersey: i + 1, position: i ? 'MID' : 'GK', started: true}));
const as = (f, provider, idBase) => ({...f, id: `${provider}:${idBase}`, provider, home: {...f.home, id: `${provider}:t${f.home.externalId}`, provider}, away: {...f.away, id: `${provider}:t${f.away.externalId}`, provider},
  competition: {...f.competition, id: `${provider}:777`, provider, seasons: [{...f.competition.seasons[0], id: `${provider}:777:2026`, competitionId: `${provider}:777`}]}, seasonId: `${provider}:777:2026`});

test('a stored LiveScore team sheet with full team IDs is recognised as confirmed', () => {
  const sheet = normalizeLineups([{team: {id: 'livescore:t10'}, players: XI('h')}], 'livescore');
  assert.equal(sheet[0].teamId, 'livescore:t10', 'no double provider prefix');
});

test('the match page shows the confirmed team sheet of the same match from a linked record; other matches never', async () => {
  const {store, sqlite} = database(); store.now = () => Date.parse('2026-11-05T11:00:00Z');
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const base = normalizeFixture('api-football', apiFixture(1, 'NS', '2026-11-05T12:00:00Z', 10, 20));
    const ours = as(base, 'fivedollar', 1), theirs = as(base, 'livescore', 1);
    const later = as(normalizeFixture('api-football', apiFixture(2, 'NS', '2026-11-12T12:00:00Z', 10, 20)), 'livescore', 2);
    await service.saveFixtures([ours, theirs, later], {liveOnly: true});
    const c = (await store.one("SELECT canonical_id FROM fixture_identities WHERE fixture_id='livescore:1'")).canonical_id;
    await store.run("UPDATE fixture_identities SET canonical_id=? WHERE fixture_id='fivedollar:1'", c);
    for (const [fid, f] of [['livescore:1', theirs], ['livescore:2', later]])
      await store.upsert('lineups', {id: fid, fixture_id: fid, label: 'Confirmed', payload: JSON.stringify([{team: {id: f.home.id, name: f.home.name}, formation: '4-4-2', players: XI('h')}, {team: {id: f.away.id, name: f.away.name}, formation: '4-3-3', players: XI('a')}]), updated_at: store.now()});
    const sib = await siblingLineups(store, ours);
    assert.equal(sib.length, 1, 'only the same match'); assert.equal(sib[0].fixtureId, 'livescore:1');
    assert.deepEqual(sib[0].data.map(t => t.team.id), [ours.home.id, ours.away.id], 'remapped by side');
    const context = await lineupContext(store, ours);
    assert.deepEqual(context.filter(x => x.label === 'Confirmed').map(x => x.team.id), [ours.home.id, ours.away.id]);
    const page = await matchContext(service, ours.id);
    assert.equal(page.details.lineups.length, 2); assert.equal(page.details.lineups[0].sourceProvider, 'livescore');
  } finally { sqlite.close(); }
});
