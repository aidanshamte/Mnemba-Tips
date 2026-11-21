// Cross-provider team identity from linked fixtures, crest propagation, history de-duplication and budget deferral.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {planTeamIdentities, applyTeamIdentities} from '../../lib/football/team-identity.mjs';
import {visualCatalog, resolveVisual} from '../../lib/football/visuals.mjs';

const row = (canonical, provider, h, hn, a, an) => ({canonical_id: canonical, provider, h, a, hn, an});

test('linked fixtures pair the same club across providers; markers and one-to-one rules prevent wrong merges', () => {
  const plan = planTeamIdentities([
    row('fixture:1', 'livescore', 'livescore:9', 'FC Augsburg', 'livescore:10', 'Werder Bremen'),
    row('fixture:1', 'fivedollar', 'fivedollar:t1', 'Augsburg', 'fivedollar:t2', 'Werder Bremen'),
    // Women's fixtures linked at the same time cannot pair a women's side with the men's club.
    row('fixture:2', 'livescore', 'livescore:30', 'Arsenal', 'livescore:31', 'Chelsea'),
    row('fixture:2', 'fivedollar', 'fivedollar:t30', 'Arsenal Women', 'fivedollar:t31', 'Chelsea Women'),
    // A provider team linked to two different clubs of one provider is a conflict.
    row('fixture:3', 'livescore', 'livescore:40', 'Real Madrid', 'livescore:41', 'Getafe'),
    row('fixture:3', 'fivedollar', 'fivedollar:t40', 'Real Madrid', 'fivedollar:t41', 'Getafe'),
    row('fixture:4', 'livescore', 'livescore:42', 'Real Madrid Castilla', 'livescore:43', 'Getafe B'),
    row('fixture:4', 'fivedollar', 'fivedollar:t40', 'Real Madrid', 'fivedollar:t44', 'Leganes'),
  ]);
  const merged = plan.merges.map(m => m.members.sort().join('='));
  assert.ok(merged.includes(['fivedollar:t1', 'livescore:9'].sort().join('=')), 'Augsburg merges with FC Augsburg');
  assert.ok(!merged.some(m => m.includes('fivedollar:t30')), "a women's side never merges with the men's club");
  assert.ok(plan.rejected.some(r => [r.x, r.y].includes('fivedollar:t30')));
  assert.ok(!merged.some(m => m.includes('fivedollar:t40')), 'a team paired with two clubs of one provider is not merged');
  assert.ok(plan.conflicts.some(c => c.members.includes('fivedollar:t40')), 'and goes to review');
});

async function world() {
  const db = database(); db.store.now = () => Date.parse('2026-11-01T12:00:00Z');
  await db.store.init(); const service = new IntelligenceService(db.store); await service.initialize();
  return {...db, service};
}
const fx = (provider, id, date, home, away, status = 'FT') => {
  const f = normalizeFixture('api-football', apiFixture(id, status, date, home, away));
  if (provider === 'api-football') return f;
  const team = t => ({...t, id: `${provider}:${t.externalId}`, provider});
  return {...f, id: `${provider}:${id}`, provider, home: team(f.home), away: team(f.away), competition: {...f.competition, id: `${provider}:777`, provider, seasons: [{...f.competition.seasons[0], id: `${provider}:777:2026`, competitionId: `${provider}:777`}]}, seasonId: `${provider}:777:2026`};
};

test('applying a merge propagates the verified crest, protects verified identities and records the prior identity', async () => {
  const w = await world();
  try {
    await w.service.saveFixtures([fx('livescore', 1, '2026-10-01T15:00:00Z', 10, 20), fx('fivedollar', 1, '2026-10-01T15:00:00Z', 10, 20)]);
    // A verified, permitted crest on the LiveScore record only.
    await w.store.run("INSERT INTO media_assets(id,url,source_url,usage_basis,attribution,verified_at,last_success,width,height,state,payload) VALUES('a1','https://upload.wikimedia.org/wikipedia/commons/a/a1/Crest.png','https://commons.wikimedia.org/wiki/File:Crest.png','CC BY-SA 4.0','Example',1,1,256,256,'verified',?)", JSON.stringify({sourceUrl: 'https://commons.wikimedia.org/wiki/File:Crest.png', usageBasis: 'CC BY-SA 4.0', attribution: 'Example', contentType: 'image/png', width: 256, height: 256}));
    await w.store.run("INSERT INTO entity_media(entity_id,entity_type,media_type,asset_id,is_primary,identity_basis) VALUES('livescore:10','team','badge','a1',1,'test')");
    assert.equal(resolveVisual({id: 'fivedollar:10'}, 'team', await visualCatalog(w.store)).verified, false, 'no crest before the merge');
    const plan = planTeamIdentities([row('fixture:x', 'livescore', 'livescore:10', 'Team 10', 'livescore:20', 'Team 20'), row('fixture:x', 'fivedollar', 'fivedollar:10', 'Team 10', 'fivedollar:20', 'Team 20')]);
    const changes = await applyTeamIdentities(w.service, plan);
    assert.ok(changes.merged >= 2);
    assert.equal(resolveVisual({id: 'fivedollar:10'}, 'team', await visualCatalog(w.store)).verified, true, 'crest inherited through the verified identity');
    assert.ok(await w.store.cache('team-identity:log:fivedollar:10') || await w.store.cache('team-identity:log:livescore:10'), 'prior identity recorded');
    // A Wikidata-verified identity on another record is never overridden.
    await w.store.run("INSERT OR IGNORE INTO canonical_entities(id,kind,name,wikidata_id,country,gender,payload,updated_at) VALUES('wd:Q1','team','Other',NULL,NULL,NULL,'{}',0)");
    await w.store.run("UPDATE entity_aliases SET canonical_id='wd:Q1',verified=1,source_url='https://www.wikidata.org/wiki/Q1' WHERE provider_id='fivedollar:20'");
    await w.store.run("UPDATE entity_aliases SET verified=1,source_url='https://www.wikidata.org/wiki/Q2' WHERE provider_id='livescore:20'");
    const again = await applyTeamIdentities(w.service, plan);
    assert.ok(again.protected >= 1);
    assert.equal((await w.store.one("SELECT canonical_id FROM entity_aliases WHERE provider_id='fivedollar:20'")).canonical_id, 'wd:Q1', 'verified identity kept');
  } finally { w.sqlite.close(); }
});

test('unified team history never counts the same match from two providers twice', async () => {
  const w = await world();
  try {
    await w.service.saveFixtures([fx('livescore', 1, '2026-10-01T15:00:00Z', 10, 20), fx('fivedollar', 9, '2026-10-01T15:05:00Z', 10, 20), fx('livescore', 2, '2026-10-08T15:00:00Z', 10, 30)]);
    const plan = planTeamIdentities([row('fixture:y', 'livescore', 'livescore:10', 'Team 10', 'livescore:20', 'Team 20'), row('fixture:y', 'fivedollar', 'fivedollar:10', 'Team 10', 'fivedollar:20', 'Team 20')]);
    await applyTeamIdentities(w.service, plan);
    const history = await w.service.history('fivedollar:10', 'fivedollar:20');
    const sameMatch = history.filter(f => Math.abs(f.startsAt - Date.parse('2026-10-01T15:00:00Z')) < 3600000);
    assert.equal(sameMatch.length, 1, 'one observation of the 1 October match');
    assert.ok(history.some(f => f.startsAt === Date.parse('2026-10-08T15:00:00Z')), 'history from the other provider is included');
  } finally { w.sqlite.close(); }
});

test('an exhausted local request budget is recorded as incomplete, not as a failing error', async () => {
  const w = await world();
  try {
    await w.store.run("INSERT INTO source_request_usage(source_id,day,used) VALUES('club-video-feed',?,100000) ON CONFLICT(source_id,day) DO UPDATE SET used=100000", w.store.day());
    const r = await w.service.sync('video-news');
    assert.equal(r.outcome, 'incomplete');
  } finally { w.sqlite.close(); }
});
