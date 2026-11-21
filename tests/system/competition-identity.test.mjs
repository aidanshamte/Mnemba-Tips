// Canonical competition identity acceptance tests. Records mirror real production provider names
// (OpenFootball, LiveScore, TheSportsDB, OpenLigaDB); fixtures carry real-style team name variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planCompetitionIdentities, resolveCompetition, parseCompetitionName, teamsMatch, normTeam} from '../../lib/football/competition-identity.mjs';
import {applyIdentities, planIdentities} from '../../lib/football/identity-migration.mjs';
import {database} from '../football-db.mjs';

const DAY = 86400000, T0 = Date.parse('2026-08-01T15:00:00Z');
const country = (name, continent = null) => ({name, continent});
const c = (id, name, ctry, extra = {}) => ({id, provider: id.split(':')[0], externalId: id.split(':')[1], name, country: ctry, type: null, ...extra});
// Round-robin fixtures between the given teams, starting on a day offset (shared days produce same-match duplicates).
const rr = (competitionId, teams, start = 0) => teams.flatMap((h, i) => teams.slice(i + 1).map((a, j) => ({competitionId, startsAt: T0 + (start + i * 7 + j) * DAY, home: h, away: a})));

const BRA_A = ['Flamengo', 'Palmeiras', 'São Paulo', 'Corinthians', 'Grêmio', 'Internacional', 'Fluminense', 'Botafogo'];
const BRA_A_LIVE = ['Flamengo RJ', 'Palmeiras', 'Sao Paulo', 'Corinthians', 'Gremio', 'Internacional', 'Fluminense', 'Botafogo'];
const AUS = ['Sydney FC', 'Melbourne Victory', 'Adelaide United', 'Brisbane Roar', 'Perth Glory', 'Wellington Phoenix'];
const BEL = ['Club Brugge', 'RSC Anderlecht', 'KRC Genk', 'Royal Antwerp', 'Standard Liège', 'KAA Gent'];
const CHN = ['Shanghai Port', 'Shandong Taishan', 'Beijing Guoan', 'Chengdu Rongcheng', 'Shanghai Shenhua', 'Tianjin Jinmen Tiger'];
const ALG = ['MC Alger', 'CR Belouizdad', 'JS Kabylie', 'ES Sétif', 'USM Alger', 'CS Constantine'];
const FRA = ['Paris Saint-Germain', 'Olympique Marseille', 'AS Monaco', 'LOSC Lille', 'OGC Nice', 'Stade Rennais'];

function world() {
  const competitions = [
    c('openfootball:a1', 'A-League Men', country('Australia', 'Oceania')), c('openfootball:a2', 'A-League Men', country('Australia', 'Oceania')), c('livescore:25896', 'A-League', country('Australia')), c('livescore:26293', 'A-League Women', country('Australia')),
    c('openfootball:b1', 'Belgian Pro League', country('Belgium', 'Europe')), c('openfootball:b2', 'Jupiler Pro League 2026/27 (Belgium First Division A)', country('Belgium', 'Europe')), c('livescore:25581', 'Belgian Pro League', country('Belgium')),
    c('openfootball:alg', 'Algerian Ligue 1', country('Algeria', 'Africa')), c('livescore:26013', 'Ligue 1', country('Algeria')), c('livescore:25561', 'Ligue 1', country('France')),
    c('openfootball:bra', 'Brasileiro Série A 2026', country('Brazil', 'South America')), c('livescore:24199', 'Serie A', country('Brazil')), c('thesportsdb:4351', 'Brazilian Serie A', null),
    c('openfootball:chn', 'China | Super League 2025', country('China', 'Asia')), c('livescore:24599', 'Super League', country('China')), c('livescore:25566', 'Super League', country('Switzerland')),
    ...'ABCDEFGHIJKL'.split('').map((g, i) => c(`livescore:afq${i}`, `Qualification: Group ${g}`, country('Africa Cup of Nations Qualification'))),
    ...'ABCDEFGH'.split('').map((g, i) => c(`livescore:acl${i}`, `AFC Champions League Two: Group ${g}`, country('Asia'))),
    c('openfootball:ucl', 'UEFA Champions League', null), c('openfootball:uclq', 'UEFA Champions League - Quali', null), c('livescore:cl', 'League Stage', country('Champions League')),
    c('livescore:26486', 'Federal A: Promotion Play-off', country('Argentina')), c('livescore:26487', 'Federal A: Promotion Play-off', country('Argentina')),
    c('livescore:ecu', 'Serie A: Championship Group', country('Ecuador')), c('openfootball:ita', 'Italian Serie A', country('Italy', 'Europe')),
    c('livescore:nln', 'National League: North', country('England')), c('livescore:nls', 'National League: South', country('England')),
    c('livescore:wsl', 'FA Women’s Super League', country('England')), c('livescore:epl', 'Premier League', country('England')),
    c('openfootball:mls', 'Major League Soccer 2025', null), c('livescore:mls', 'MLS', country('USA')),
    c('livescore:low', 'Premier League', country('Egypt')), c('openfootball:egy', 'Egyptian Premier League', country('Egypt', 'Africa')),
  ];
  const fixtures = [
    ...rr('openfootball:a1', AUS), ...rr('openfootball:a2', AUS, 400), ...rr('livescore:25896', AUS.map(t => t.replace(' FC', ''))), ...rr('livescore:26293', ['Sydney FC Women', 'Melbourne City Women', 'Adelaide United Women']),
    ...rr('openfootball:b1', BEL), ...rr('openfootball:b2', BEL, 400), ...rr('livescore:25581', BEL.map(t => t.replace(/^(Club|RSC|KRC|Royal|KAA) /, ''))),
    ...rr('openfootball:alg', ALG), ...rr('livescore:26013', ALG), ...rr('livescore:25561', FRA),
    ...rr('openfootball:bra', BRA_A), ...rr('livescore:24199', BRA_A_LIVE), ...rr('thesportsdb:4351', BRA_A.slice(0, 4)),
    ...rr('openfootball:chn', CHN), ...rr('livescore:24599', CHN, 400), ...rr('livescore:25566', ['FC Basel', 'BSC Young Boys', 'FC Zürich', 'Servette FC']),
    ...'ABCDEFGHIJKL'.split('').flatMap((g, i) => rr(`livescore:afq${i}`, [`Nation ${g}1`, `Nation ${g}2`, `Nation ${g}3`, `Nation ${g}4`])),
    ...'ABCDEFGH'.split('').flatMap((g, i) => rr(`livescore:acl${i}`, [`Club ${g}1`, `Club ${g}2`, `Club ${g}3`, `Club ${g}4`])),
    ...rr('openfootball:ucl', ['Real Madrid', 'FC Bayern München', 'Arsenal FC', 'Inter']), ...rr('openfootball:uclq', ['Celtic', 'Ferencváros']), ...rr('livescore:cl', ['PSV', 'Benfica', 'Napoli', 'Atalanta']),
    ...rr('livescore:26486', ['Ciudad Bolívar', 'Sportivo Belgrano']), ...rr('livescore:26487', ['Olimpo', 'Villa Mitre']),
    ...rr('livescore:ecu', ['Barcelona SC', 'LDU Quito', 'Independiente del Valle']), ...rr('openfootball:ita', ['Juventus', 'AC Milan', 'Inter', 'AS Roma']),
    ...rr('livescore:nln', ['Chester', 'Darlington', 'Scarborough Athletic']), ...rr('livescore:nls', ['Bath City', 'Dorking Wanderers', 'Hampton & Richmond']),
    ...rr('livescore:wsl', ['Chelsea Women', 'Arsenal Women', 'Manchester City Women']), ...rr('livescore:epl', ['Arsenal', 'Chelsea', 'Manchester City', 'Liverpool']),
    ...rr('openfootball:mls', ['LA Galaxy', 'Inter Miami CF', 'Seattle Sounders FC', 'Columbus Crew']), ...rr('livescore:mls', ['LA Galaxy', 'Inter Miami', 'Seattle Sounders', 'Columbus Crew'], 400),
    ...rr('livescore:low', ['Al Ahly', 'Zamalek', 'Pyramids', 'Al Masry']), ...rr('openfootball:egy', ['Ismaily', 'ENPPI', 'El Gouna', 'Ghazl El Mahalla']),
  ];
  return {competitions, fixtures};
}
const plan = () => { const w = world(); return planCompetitionIdentities(w.competitions, w.fixtures); };
const groupOf = (p, providerId) => p.groups.find(g => g.providerIds.includes(providerId));
const named = (p, name, scope) => p.groups.filter(g => g.name === name && (!scope || g.country === scope || g.governingBody === scope));

test('A-League Men appears once; A-League is an alias; the women\'s league stays separate', () => {
  const p = plan(), g = groupOf(p, 'livescore:25896');
  assert.equal(named(p, 'A-League Men', 'Australia').length, 1);
  assert.deepEqual(g.providerIds.sort(), ['livescore:25896', 'openfootball:a1', 'openfootball:a2']);
  assert.notEqual(groupOf(p, 'livescore:26293').canonicalId, g.canonicalId);
  assert.equal(groupOf(p, 'livescore:26293').gender, 'women');
});

test('Belgian Pro League appears once and Jupiler Pro League resolves as its alias', () => {
  const p = plan(), g = groupOf(p, 'openfootball:b2');
  assert.equal(named(p, 'Belgian Pro League', 'Belgium').length, 1);
  assert.deepEqual(g.providerIds.sort(), ['livescore:25581', 'openfootball:b1', 'openfootball:b2']);
  assert.ok(g.aliases.some(a => /Jupiler/.test(a)));
  assert.ok(g.seasons.includes('2026/27'));
});

test("Algerian Ligue 1 stays separate from France's Ligue 1", () => {
  const p = plan();
  assert.equal(groupOf(p, 'livescore:26013').canonicalId, groupOf(p, 'openfootball:alg').canonicalId);
  assert.notEqual(groupOf(p, 'livescore:26013').canonicalId, groupOf(p, 'livescore:25561').canonicalId);
  assert.equal(groupOf(p, 'livescore:25561').country, 'France');
});

test('Brazilian Série A appears once across three providers', () => {
  const p = plan();
  assert.equal(named(p, 'Brazilian Série A', 'Brazil').length, 1);
  assert.equal(groupOf(p, 'thesportsdb:4351').canonicalId, groupOf(p, 'openfootball:bra').canonicalId);
  assert.equal(groupOf(p, 'livescore:24199').canonicalId, groupOf(p, 'openfootball:bra').canonicalId);
});

test('Chinese Super League appears once with its season; Swiss Super League stays separate', () => {
  const p = plan(), g = groupOf(p, 'openfootball:chn');
  assert.equal(named(p, 'Chinese Super League', 'China').length, 1);
  assert.ok(g.providerIds.includes('livescore:24599'));
  assert.ok(g.seasons.includes('2025'));
  assert.notEqual(groupOf(p, 'livescore:25566').canonicalId, g.canonicalId);
});

test('AFCON qualification and AFC Champions League Two appear once with groups inside', () => {
  const p = plan(), afq = groupOf(p, 'livescore:afq0'), acl = groupOf(p, 'livescore:acl0');
  assert.equal(afq.name, 'Africa Cup of Nations Qualification'); assert.equal(afq.governingBody, 'CAF'); assert.equal(afq.providerIds.length, 12);
  assert.equal(afq.stages.find(s => s.name === 'Group stage').groups.length, 12);
  assert.equal(acl.name, 'AFC Champions League Two'); assert.equal(acl.governingBody, 'AFC'); assert.equal(acl.stages[0].groups.length, 8);
  assert.equal(p.groups.filter(g => /Group [A-L]/.test(g.name)).length, 0);
});

test('UEFA Champions League league stage and qualification are not separate competitions', () => {
  const p = plan(), g = groupOf(p, 'livescore:cl');
  assert.equal(g.name, 'UEFA Champions League');
  assert.deepEqual(g.providerIds.sort(), ['livescore:cl', 'openfootball:ucl', 'openfootball:uclq']);
  assert.deepEqual(g.stages.map(s => s.name).sort(), ['League Stage', 'Qualification']);
  assert.equal(p.groups.filter(g => g.name === 'League Stage').length, 0);
});

test('Federal A promotion play-off stages do not create duplicate leagues', () => {
  const p = plan();
  assert.equal(groupOf(p, 'livescore:26486').canonicalId, groupOf(p, 'livescore:26487').canonicalId);
  assert.equal(groupOf(p, 'livescore:26486').name, 'Federal A');
});

test('fixture counts use distinct matches, not summed provider rows', () => {
  const p = plan(), bra = groupOf(p, 'openfootball:bra'), mls = groupOf(p, 'livescore:mls');
  // 28 matches in each 8-team round robin; 6 of the TheSportsDB matches and the LiveScore copy are the same matches.
  assert.equal(bra.providerRows, 28 + 28 + 6);
  assert.equal(bra.distinctFixtures, 28);
  assert.equal(mls.distinctFixtures, 12, 'two different seasons are distinct matches');
});

test('same-name competitions in other countries, regional divisions and women\'s leagues stay separate', () => {
  const p = plan();
  assert.notEqual(groupOf(p, 'livescore:ecu').canonicalId, groupOf(p, 'openfootball:ita').canonicalId);
  assert.notEqual(groupOf(p, 'livescore:nln').canonicalId, groupOf(p, 'livescore:nls').canonicalId);
  assert.equal(groupOf(p, 'livescore:nln').name, 'National League North');
  assert.notEqual(groupOf(p, 'livescore:wsl').canonicalId, groupOf(p, 'livescore:epl').canonicalId);
});

test('a name match without team overlap is never merged: it is kept separate and queued for review', () => {
  const p = plan();
  assert.notEqual(groupOf(p, 'livescore:low').canonicalId, groupOf(p, 'openfootball:egy').canonicalId);
  assert.ok(p.reviews.some(r => ['livescore:low', 'openfootball:egy'].includes(r.providerId) && r.kind === 'competition-merge' && r.evidence.shared === 0));
});

test('a country is read only from an alias unique to one country (Major League Soccer)', () => {
  const p = plan();
  assert.equal(groupOf(p, 'openfootball:mls').canonicalId, groupOf(p, 'livescore:mls').canonicalId);
  assert.equal(resolveCompetition(c('thesportsdb:x', 'Premier League', null)).scopeKind, 'unscoped');
});

test('names are parsed into competition, stage, group and season', () => {
  assert.deepEqual(parseCompetitionName('Primera B: Clausura: Play-off: Group B', 'Colombia').stages, ['Clausura', 'Play-off']);
  assert.equal(parseCompetitionName('Brasileiro Série A 2026', 'Brazil').season, '2026');
  assert.equal(parseCompetitionName('China | Super League 2025', 'China').base, 'Super League');
  assert.equal(resolveCompetition(c('livescore:x', 'EFL Trophy North: Group A', country('England'))).name, 'EFL Trophy');
  assert.equal(resolveCompetition(c('livescore:x', 'AFC Champions League Elite: West', country('Asia'))).stage, 'West');
});

test('team variants match for overlap evidence only with a distinctive shared token', () => {
  assert.ok(teamsMatch(normTeam('Goiás GO'), normTeam('Goias')));
  assert.ok(teamsMatch(normTeam('RC Strasbourg Alsace'), normTeam('Strasbourg')));
  assert.ok(!teamsMatch(normTeam('Paris FC'), normTeam('Paris Saint-Germain')));
  assert.ok(!teamsMatch(normTeam('Barcelona SC'), normTeam('Atlético Mineiro')));
});

test('planning is deterministic and applying it twice changes nothing (re-import creates no duplicates)', async () => {
  const {store, sqlite} = database();
  try {
    await store.init();
    const now = Date.parse('2026-11-21T00:00:00Z'); store.now = () => now;
    // Persist a small subset through the real schema.
    const rows = world().competitions.filter(x => /a1|a2|25896|b1|b2|25581/.test(x.id));
    for (const r of rows) {
      const ctry = r.country ? {id: `${r.provider}:country:${r.country.name}`, provider: r.provider, externalId: r.country.name, name: r.country.name, code: null, continent: r.country.continent} : null;
      if (ctry) await store.run('INSERT OR IGNORE INTO countries(id,provider,external_id,name,code,continent,payload,updated_at) VALUES(?,?,?,?,?,?,?,?)', ctry.id, ctry.provider, ctry.externalId, ctry.name, null, ctry.continent, JSON.stringify(ctry), now);
      await store.run('INSERT INTO competitions(id,provider,external_id,country_id,name,type,payload,updated_at) VALUES(?,?,?,?,?,?,?,?)', r.id, r.provider, r.externalId, ctry?.id ?? null, r.name, 'league', JSON.stringify({...r, country: ctry}), now);
      await store.run('INSERT INTO seasons(id,competition_id,year,current,coverage,payload,updated_at) VALUES(?,?,?,?,?,?,?)', `${r.id}:s`, r.id, 2026, 1, '{}', '{}', now);
      await store.run('INSERT INTO canonical_entities(id,kind,name,wikidata_id,country,gender,payload,updated_at) VALUES(?,?,?,?,?,?,?,?)', `entity:${r.id}`, 'competition', r.name, null, null, null, '{}', now);
      await store.run('INSERT INTO entity_aliases(id,canonical_id,provider,provider_id,alias,normalized_alias,verified,source_url) VALUES(?,?,?,?,?,?,?,?)', `a:${r.id}`, `entity:${r.id}`, r.provider, r.id, r.name, r.name.toLowerCase(), 0, '');
      const teams = /^openfootball:a|25896/.test(r.id) ? AUS : BEL;
      for (const t of teams) await store.run('INSERT OR IGNORE INTO football_teams(id,provider,external_id,name,country_id,payload,updated_at) VALUES(?,?,?,?,?,?,?)', `${r.provider}:${t}`, r.provider, t, t, null, '{}', now);
      for (const [i, f] of rr(r.id, teams).entries()) await store.run('INSERT INTO fixtures(id,provider,external_id,competition_id,season_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,label,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', `${r.id}:f${i}`, r.provider, `${r.id}:f${i}`, r.id, `${r.id}:s`, `${r.provider}:${f.home}`, `${r.provider}:${f.away}`, f.startsAt, 'FT', 1, 0, 'Historical', '{}', now);
    }
    const first = await planIdentities(store), applied = await applyIdentities(store, first);
    assert.ok(applied.canonical >= 2 && applied.aliases >= 4);
    const second = await planIdentities(store);
    assert.deepEqual(second, first, 'deterministic plan');
    assert.deepEqual(await applyIdentities(store, second), {canonical: 0, aliases: 0, queued: 0}, 'idempotent apply');
    const aus = await store.all("SELECT DISTINCT canonical_id FROM entity_aliases WHERE provider_id IN ('openfootball:a1','openfootball:a2','livescore:25896')");
    assert.equal(aus.length, 1);
    assert.equal((await store.one('SELECT COUNT(*) n FROM competitions')).n, rows.length, 'provider records are never deleted');
  } finally { sqlite.close(); }
});

test('catalog, competition page and daily task use the evidence-checked identity', async () => {
  const {IntelligenceService} = await import('../../lib/football/intelligence.mjs');
  const {normalizeFixture} = await import('../../lib/football/providers.mjs');
  const {apiFixture} = await import('../football-db.mjs');
  const {store, sqlite} = database();
  try {
    await store.init(); const now = Date.parse('2026-11-21T00:00:00Z'); store.now = () => now;
    const service = new IntelligenceService(store); await service.initialize();
    // Two providers, one competition (same teams), saved through the real import path.
    const raw = (id, comp, home, away, day) => { const f = normalizeFixture('api-football', apiFixture(id, 'FT', `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, home, away)); return {...f, competition: {...comp, seasons: [{id: `${comp.id}:2026`, competitionId: comp.id, year: 2026, current: true, coverage: {}}]}, seasonId: `${comp.id}:2026`}; };
    const aus = {name: 'Australia', id: 'x:au', provider: 'x', externalId: 'au', code: null, continent: 'Oceania'};
    const a = {id: 'openfootball:aleague', provider: 'openfootball', externalId: 'aleague', name: 'A-League Men', type: 'league', country: aus};
    const b = {id: 'livescore:25896', provider: 'livescore', externalId: '25896', name: 'A-League', type: 'league', country: aus};
    const teamsA = [[11, 'Sydney FC'], [12, 'Melbourne Victory'], [13, 'Adelaide United'], [14, 'Perth Glory']];
    let n = 5000, day = 1;
    const fx = [];
    for (const comp of [a, b]) for (const [hi, hn] of teamsA) for (const [ai, an] of teamsA) if (hi !== ai) { const f = raw(n++, comp, hi + (comp === b ? 100 : 0), ai + (comp === b ? 100 : 0), day++ % 28 + 1); fx.push({...f, home: {...f.home, name: hn}, away: {...f.away, name: an}}); }
    await service.saveFixtures(fx);
    const before = (await service.read(new URLSearchParams({view: 'catalog'}))).competitions.filter(c => /A-League/.test(c.name));
    assert.equal(before.length, 2, 'without the identity run, providers are not merged by name');
    const run = await service.sync('competition-identities');
    assert.ok(run.changes.aliases >= 2);
    const after = (await service.read(new URLSearchParams({view: 'catalog'}))).competitions.filter(c => /A-League/.test(c.name));
    assert.equal(after.length, 1);
    assert.equal(after[0].name, 'A-League Men');
    assert.deepEqual(after[0].providerIds.sort(), ['livescore:25896', 'openfootball:aleague']);
    const page = await service.read(new URLSearchParams({view: 'competition', id: 'livescore:25896'}));
    assert.equal(page.canonicalId, after[0].id);
    assert.equal(page.legacyId, 'livescore:25896');
    assert.equal(page.competition.name, 'A-League Men');
    assert.equal((await service.sync('competition-identities')).changes.aliases, 0, 'daily task is idempotent');
    // A newly imported provider copy is not merged across providers until the next evidence-checked run.
    const c = {id: 'thesportsdb:4356', provider: 'thesportsdb', externalId: '4356', name: 'A-League Men', type: 'league', country: aus};
    await service.saveFixtures([raw(n++, c, 211, 212, 3)]);
    assert.equal((await service.read(new URLSearchParams({view: 'catalog'}))).competitions.filter(x => /A-League/.test(x.name)).length, 2);
  } finally { sqlite.close(); }
});

test('provider naming variants merge only on shared matches; tiers, women and cups stay separate', async () => {
  const {planCompetitionIdentities} = await import('../../lib/football/competition-identity.mjs');
  const de = {name: 'Germany', code: 'DE'};
  const comps = [
    {id: 'openligadb:bl1', provider: 'openligadb', name: 'Bundesliga', country: de, type: 'league'},
    {id: 'openligadb:bl2', provider: 'openligadb', name: '2. Bundesliga', country: de, type: 'league'},
    {id: 'fivedollar:l1', provider: 'fivedollar', name: 'Germany Bundesliga I', country: de, type: null},
    {id: 'fivedollar:l2', provider: 'fivedollar', name: 'Germany Bundesliga II', country: de, type: null},
    {id: 'fivedollar:l3', provider: 'fivedollar', name: 'Germany Frauen Bundesliga', country: de, type: null},
    {id: 'fivedollar:l4', provider: 'fivedollar', name: 'Germany DFB Pokal', country: de, type: null},
    {id: 'fivedollar:l5', provider: 'fivedollar', name: 'Germany Regionalliga', country: de, type: null},
  ];
  const day = i => Date.parse('2026-10-01T15:30:00Z') + i * 86400000;
  const top = ['FC Bayern München', 'Borussia Dortmund', 'RB Leipzig', 'Bayer 04 Leverkusen', 'VfB Stuttgart', 'Eintracht Frankfurt', 'SC Freiburg', 'VfL Wolfsburg', 'TSG Hoffenheim', 'Werder Bremen', '1. FC Union Berlin', 'FC Augsburg'];
  const second = ['Hamburger SV', 'FC Schalke 04', 'Hertha BSC', 'Fortuna Düsseldorf', 'Hannover 96', '1. FC Nürnberg', 'Karlsruher SC', 'SC Paderborn 07', 'SV Darmstadt 98', 'Arminia Bielefeld', '1. FC Magdeburg', 'Holstein Kiel'];
  const fx = [];
  const league = (id, teams, rename = n => n, offset = 0) => { for (let i = 0; i < 6; i++) fx.push({competitionId: id, startsAt: day(i * 7 + offset), home: rename(teams[2 * i]), away: rename(teams[2 * i + 1])}); for (let i = 0; i < 6; i++) fx.push({competitionId: id, startsAt: day(i * 7 + 3 + offset), home: rename(teams[2 * i + 1]), away: rename(teams[(2 * i + 2) % 12])}); };
  league('openligadb:bl1', top); league('fivedollar:l1', top, n => n.replace('FC Bayern München', 'Bayern Munich').replace('Bayer 04 Leverkusen', 'Bayer Leverkusen'));
  league('openligadb:bl2', second); league('fivedollar:l2', second);
  league('fivedollar:l3', top);                 // identical clubs and days, but a women's competition
  league('fivedollar:l4', top, n => n, 1);      // the same clubs in a cup, never the same match
  // Weak overlap: two shared matches only.
  fx.push({competitionId: 'fivedollar:l5', startsAt: day(0), home: top[0], away: top[1]}, {competitionId: 'fivedollar:l5', startsAt: day(7), home: top[2], away: top[3]});
  for (let i = 0; i < 6; i++) fx.push({competitionId: 'fivedollar:l5', startsAt: day(50 + i), home: `Regional ${i}a`, away: `Regional ${i}b`});
  const plan = planCompetitionIdentities(comps, fx);
  const canon = id => plan.memberships.find(m => m.providerId === id).canonicalId;
  assert.equal(canon('fivedollar:l1'), canon('openligadb:bl1'), 'Germany Bundesliga I is the Bundesliga');
  assert.equal(plan.memberships.find(m => m.providerId === 'fivedollar:l1').evidence.basis, 'shared-matches');
  assert.equal(canon('fivedollar:l2'), canon('openligadb:bl2'), 'Germany Bundesliga II is the 2. Bundesliga');
  assert.notEqual(canon('openligadb:bl1'), canon('openligadb:bl2'), 'tiers stay separate');
  assert.notEqual(canon('fivedollar:l3'), canon('openligadb:bl1'), "women's competition never merges with the men's");
  assert.notEqual(canon('fivedollar:l4'), canon('openligadb:bl1'), 'a cup with the same clubs is not the league');
  assert.notEqual(canon('fivedollar:l5'), canon('openligadb:bl1'), 'two shared matches are not enough');
  assert.ok(plan.reviews.some(r => r.providerId === 'fivedollar:l5' && r.kind === 'competition-possible-duplicate' && r.evidence.basis === 'shared-matches'), 'weak overlap goes to review');
  assert.equal(new Set(plan.groups.map(g => g.canonicalId)).size, plan.groups.length, 'no duplicate canonical groups');
});

test('a possible-duplicate review hides a licensed-provider newcomer but never an established competition', async () => {
  const {database} = await import('../football-db.mjs');
  const {catalogCompetitions} = await import('../../lib/football/identity-migration.mjs');
  const {IntelligenceService} = await import('../../lib/football/intelligence.mjs');
  const {normalizeFixture} = await import('../../lib/football/providers.mjs');
  const {apiFixture} = await import('../football-db.mjs');
  const {store, sqlite} = database(); store.now = () => Date.parse('2026-11-01T12:00:00Z');
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const established = normalizeFixture('api-football', apiFixture(8001, 'NS', '2026-11-05T12:00:00Z'));
    const newcomer = {...normalizeFixture('api-football', apiFixture(8002, 'NS', '2026-11-05T12:00:00Z', 30, 40)), id: 'fivedollar:8002', provider: 'fivedollar',
      competition: {...established.competition, id: 'fivedollar:l9', provider: 'fivedollar', externalId: '9', name: 'Ghana Premier League', seasons: [{...established.competition.seasons[0], id: 'fivedollar:l9:2026', competitionId: 'fivedollar:l9'}]}, seasonId: 'fivedollar:l9:2026'};
    await service.saveFixtures([established, newcomer]);
    await service.sync('competition-identities');
    for (const id of [established.competition.id, 'fivedollar:l9']) await store.run("INSERT INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES(?,?,?,?,?,?,?)", `identity:competition-possible-duplicate:${id}`, 'competition-possible-duplicate', id, 'https://example.invalid', '{}', 'pending', 0);
    const ids = (await catalogCompetitions(store)).flatMap(c => c.providerIds);
    assert.ok(ids.includes(established.competition.id), 'established competition stays visible');
    assert.ok(!ids.includes('fivedollar:l9'), 'licensed-provider newcomer is hidden until reviewed');
    // Review filed against the established record, naming the newcomer's canonical competition as the comparison.
    await store.run("DELETE FROM verification_queue WHERE kind='competition-possible-duplicate'");
    const newcomerCanonical = (await store.one("SELECT canonical_id FROM entity_aliases WHERE provider_id='fivedollar:l9'")).canonical_id;
    await store.run("INSERT INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES(?,?,?,?,?,?,?)", `identity:competition-possible-duplicate:${established.competition.id}`, 'competition-possible-duplicate', established.competition.id, 'https://example.invalid', JSON.stringify({canonicalId: newcomerCanonical}), 'pending', 0);
    const again = (await catalogCompetitions(store)).flatMap(c => c.providerIds);
    assert.ok(again.includes(established.competition.id), 'established competition still visible');
    assert.ok(!again.includes('fivedollar:l9'), 'newcomer hidden when it is the compared side');
  } finally { sqlite.close(); }
});

test('a new stage record of a provider already in a canonical competition joins it before the next identity run', async () => {
  const {database, apiFixture} = await import('../football-db.mjs');
  const {catalogCompetitions} = await import('../../lib/football/identity-migration.mjs');
  const {IntelligenceService} = await import('../../lib/football/intelligence.mjs');
  const {normalizeFixture} = await import('../../lib/football/providers.mjs');
  const {store, sqlite} = database(); store.now = () => Date.parse('2026-11-01T12:00:00Z');
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const base = normalizeFixture('api-football', apiFixture(9001, 'NS', '2026-11-05T12:00:00Z'));
    const league = c => ({...base.competition, ...c, seasons: [{...base.competition.seasons[0], id: `${c.id}:2026`, competitionId: c.id}]});
    const main = {...base, id: 'livescore:9001', provider: 'livescore', externalId: '9001', home: {...base.home, id: 'livescore:t1', provider: 'livescore', externalId: 't1'}, away: {...base.away, id: 'livescore:t2', provider: 'livescore', externalId: 't2'}, competition: league({id: 'livescore:100', provider: 'livescore', externalId: '100', name: 'Allsvenskan', country: {id: 'livescore:SE', provider: 'livescore', externalId: 'SE', name: 'Sweden', code: 'SE', continent: 'Europe'}}), seasonId: 'livescore:100:2026'};
    await service.saveFixtures([main]); await service.sync('competition-identities');
    // A later LiveScore stage record of the same competition, not yet mapped; and another provider's same-named record.
    const stage = {...main, id: 'livescore:9002', externalId: '9002', competition: league({...main.competition, id: 'livescore:101', externalId: '101'}), seasonId: 'livescore:101:2026', home: {...main.home, id: 'livescore:t3', externalId: 't3', name: 'Team 3'}, away: {...main.away, id: 'livescore:t4', externalId: 't4', name: 'Team 4'}};
    const other = {...main, id: 'thesportsdb:9003', provider: 'thesportsdb', externalId: '9003', competition: league({...main.competition, id: 'thesportsdb:555', provider: 'thesportsdb', externalId: '555', country: {...main.competition.country, id: 'thesportsdb:SE', provider: 'thesportsdb'}}), seasonId: 'thesportsdb:555:2026', home: {...main.home, id: 'thesportsdb:t5', provider: 'thesportsdb', externalId: 't5', name: 'Team 5'}, away: {...main.away, id: 'thesportsdb:t6', provider: 'thesportsdb', externalId: 't6', name: 'Team 6'}};
    await service.saveFixtures([stage, other]);
    const cards = (await catalogCompetitions(store)).filter(c => c.name === 'Allsvenskan');
    const withMain = cards.find(c => c.providerIds.includes('livescore:100'));
    assert.ok(withMain.providerIds.includes('livescore:101'), 'same-provider stage record joins the persisted group');
    assert.ok(!withMain.providerIds.includes('thesportsdb:555'), 'another provider is never joined by name');
  } finally { sqlite.close(); }
});
