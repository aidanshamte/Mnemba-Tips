// 5DollarFootballAPI adapter: deterministic tests with a mocked network through the real SourceHttp layer.
// Covers status mapping and settlement, the shared per-minute limit, the run budget, Retry-After, the circuit breaker,
// the emergency switch, secret containment, duplicate prevention, cross-provider linking, grading and standings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';
import {CRON_JOBS} from '../../lib/football/scheduled.mjs';
import {normalizeFdfaFixture, fdfaState, sameTeam, syncFiveDollar, normalizeFdfaStandings, PER_MINUTE} from '../../lib/football/fivedollar.mjs';

const SECRET = 'test-only-fdfa-secret-7f3a9c';
const KICKOFF = Date.parse('2026-11-20T18:00:00Z');
const LEAGUES = [
  {id: 100, name: 'Ghana Premier League', country: {code: 'GH', name: 'Ghana'}, is_popular: true, has_standings: true, seasons: [{season: '2026', current: true}]},
  {id: 200, name: 'Ghana FA Cup', country: {code: 'GH', name: 'Ghana'}, is_popular: false, has_standings: false, seasons: []},
  {id: 300, name: 'Ghana Division Two', country: {code: 'GH', name: 'Ghana'}, is_popular: false, has_standings: false, last_fixture_ts: Date.parse('2024-05-01T00:00:00Z') / 1000, seasons: []},
  {id: 400, name: 'Club Friendlies', country: null, is_popular: false, has_standings: false, seasons: []},
];
const raw = (id, status, extra = {}) => ({
  id, league: {id: 100, name: 'Ghana Premier League'}, teams: {home: {id: 10, name: 'Team 10'}, away: {id: 20, name: 'Team 20'}},
  kickoff_utc: new Date(KICKOFF).toISOString(), kickoff_ts: KICKOFF / 1000, status, status_reason: null, status_code: status === 'finished' ? 'full' : status === 'in_play' ? '27' : null,
  goals: status === 'scheduled' ? {home: null, away: null, half_home: null, half_away: null} : {home: 2, away: 1, half_home: 1, half_away: 0},
  corners: {home: 5, away: 3, half_home: 2, half_away: 1}, cards: {home: {yellow: 2, red: 0}, away: {yellow: 1, red: 1}}, ...extra,
});
const DETAILS = {
  events: [{type: 'goal', minute: 28, team: 'home', count: 1}, {type: 'yellow_card', minute: 40, team: 'away', count: 1}],
  statistics: {attacks: {home: 90, away: 60}, possession: {home: 55, away: 45}, shots_on_target: {home: 6, away: 2}, first_half: {possession: {home: 52, away: 48}}},
  odds: {'1x2': {opening: {home: 1.9, draw: 3.4, away: 4.1}, closing: {home: 1.8, draw: 3.5, away: 4.4}, inplay: null}},
};

async function world({env = {FIVE_DOLLAR_FOOTBALL_API_KEY: SECRET}, start = '2026-11-20T12:00:00Z', respond} = {}) {
  const db = database(); const clock = {now: Date.parse(start)}; db.store.now = () => clock.now;
  await db.store.init();
  let fixtures = [], standings = null;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), headers = new Headers(init.headers), params = Object.fromEntries(u.searchParams);
    calls.push({at: clock.now, path: u.pathname.replace('/v1', ''), params, auth: headers.get('authorization'), href: u.href});
    const custom = respond?.(u, calls.length);
    if (custom) return custom;
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': String(Math.ceil(clock.now / 60000) * 60)}});
    if (u.pathname === '/v1/leagues') return json({success: 1, data: LEAGUES, pagination: {page: 1, per_page: 100, count: 2, has_more: false}});
    if (u.pathname === '/v1/standings') return standings ? json({success: 1, data: standings}) : json({success: 0, error: {type: 'invalid_request', code: 'standings_not_available'}}, 404);
    if (u.pathname === '/v1/fixtures') {
      const want = {live: 'in_play', finished: 'finished', scheduled: 'scheduled'}[params.status];
      let rows = fixtures.filter(f => !want || f.status === want);
      if (params.start_time) rows = rows.filter(f => f.kickoff_ts >= Number(params.start_time) && f.kickoff_ts <= Number(params.end_time));
      if (params.include) rows = rows.map(f => ({...f, ...(params.include.includes('events') ? {events: DETAILS.events} : {}), ...(params.include.includes('stats') ? {statistics: DETAILS.statistics} : {}), ...(params.include.includes('odds') ? {odds: DETAILS.odds} : {})}));
      return json({success: 1, data: rows, pagination: {page: Number(params.page ?? 1), per_page: Number(params.per_page), count: rows.length, has_more: false}});
    }
    return json({success: 0, error: {type: 'invalid_request', code: 'not_found'}}, 404);
  };
  const service = new IntelligenceService(db.store, env, {fetcher, sleep: async ms => { clock.now += ms; }});
  await service.initialize();
  return {...db, service, calls, clock, setFixtures: f => { fixtures = f; }, setStandings: t => { standings = t; }, advance: ms => { clock.now += ms; }};
}
const fixtureRow = (store, id) => store.one('SELECT status,home_score,away_score FROM fixtures WHERE id=?', id);

async function dumpContains(sqlite, needle) {
  for (const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())
    for (const row of sqlite.prepare(`SELECT * FROM "${name}"`).all()) if (JSON.stringify(row).includes(needle)) return name;
  return null;
}

test('status mapping settles only an unqualified finished result; cup scores are not treated as regulation', () => {
  const catalog = new Map(LEAGUES.map(l => [l.id, l]));
  const scheduled = normalizeFdfaFixture(raw(1, 'scheduled'), catalog);
  assert.equal(scheduled.status, 'NS'); assert.equal(scheduled.homeScore, null);
  assert.equal(scheduled.seasonId, 'fivedollar:l100:2026');
  assert.equal(scheduled.home.id, 'fivedollar:t10'); assert.equal(scheduled.competition.id, 'fivedollar:l100');
  assert.equal(normalizeFdfaFixture(raw(2, 'in_play'), catalog).status, '1H');
  assert.equal(normalizeFdfaFixture(raw(3, 'in_play', {status_code: 'half'}), catalog).status, 'HT');
  assert.equal(normalizeFdfaFixture(raw(3, 'in_play', {status_code: '67'}), catalog).status, '2H');
  assert.equal(normalizeFdfaFixture(raw(3, 'in_play', {status_code: 'full'}), catalog).status, 'LIVE');
  const final = normalizeFdfaFixture(raw(4, 'finished'), catalog);
  assert.equal(final.status, 'FT'); assert.deepEqual(final.regulationScore, {home: 2, away: 1});
  assert.deepEqual(final.corners, {home: 5, away: 3, halfHome: 2, halfAway: 1}); assert.equal(final.cards.away.red, 1);
  const unconfirmed = normalizeFdfaFixture(raw(5, 'finished', {status_reason: 'result_unconfirmed'}), catalog);
  assert.equal(unconfirmed.status, 'UNKNOWN'); assert.equal(unconfirmed.regulationScore, undefined);
  assert.equal(normalizeFdfaFixture(raw(6, 'unknown'), catalog).status, 'UNKNOWN');
  const cup = normalizeFdfaFixture(raw(7, 'finished', {league: {id: 200, name: 'Ghana FA Cup'}}), catalog);
  assert.equal(cup.status, 'UNKNOWN', 'a cup final score may include extra time');
  assert.equal(final.sourceUrl, 'https://api.5dollarfootballapi.com/v1/fixtures/4');
  assert.throws(() => normalizeFdfaFixture({...raw(8, 'scheduled'), kickoff_ts: null}, catalog), /kickoff/);
});

test('team matching keeps gender, age and reserve sides apart', () => {
  assert.ok(sameTeam('Corinthians', 'SC Corinthians'));
  assert.ok(!sameTeam('Arsenal', 'Arsenal Women'));
  assert.ok(!sameTeam('Flamengo', 'Flamengo U20'));
  assert.ok(!sameTeam('Real Madrid', 'Real Madrid B'));
  assert.ok(!sameTeam('Team 10', 'Team 20'));
});

test('emergency switch and a missing key make no requests and fail safely', async () => {
  assert.deepEqual(fdfaState({}), {enabled: false, reason: 'Provider key not configured'});
  assert.equal(fdfaState({FIVE_DOLLAR_FOOTBALL_API_KEY: SECRET, MNEMBA_FDFA_DISABLED: '1'}).reason, 'Disabled by emergency switch');
  for (const env of [{}, {FIVE_DOLLAR_FOOTBALL_API_KEY: SECRET, MNEMBA_FDFA_DISABLED: '1'}]) {
    const w = await world({env});
    try {
      const result = await w.service.sync('fivedollar');
      assert.equal(result.state, 'disabled'); assert.equal(result.outcome, 'success');
      assert.equal(w.calls.length, 0);
      const source = await w.store.one("SELECT enabled,disabled_reason FROM source_registry WHERE id='fivedollar'");
      assert.equal(source.enabled, 0);
    } finally { w.sqlite.close(); }
  }
});

test('core sync stores fixtures, respects the shared per-minute limit and never exposes the key', async () => {
  const w = await world();
  try {
    w.setFixtures([raw(11, 'finished', {kickoff_ts: Date.parse('2026-11-20T09:00:00Z') / 1000}), raw(12, 'in_play'), raw(13, 'scheduled', {kickoff_ts: Date.parse('2026-11-21T15:00:00Z') / 1000})]);
    const result = await w.service.sync('fivedollar');
    assert.equal(result.outcome, 'success', JSON.stringify(result.errors) + result.deferred);
    assert.equal((await fixtureRow(w.store, 'fivedollar:11')).status, 'FT');
    assert.equal((await fixtureRow(w.store, 'fivedollar:12')).status, '1H');
    assert.equal((await fixtureRow(w.store, 'fivedollar:13')).status, 'NS');
    assert.ok(result.requests <= 8, 'run budget');
    // Authorization header only; never in the URL, the database, the job record or the result.
    for (const c of w.calls) { assert.equal(c.auth, `Bearer ${SECRET}`); assert.ok(!c.href.includes(SECRET)); }
    assert.equal(await dumpContains(w.sqlite, SECRET), null);
    assert.ok(!JSON.stringify(result).includes(SECRET));
    // Shared per-minute cap and minimum gap.
    const perMinute = new Map(); for (const c of w.calls) perMinute.set(Math.floor(c.at / 60000), (perMinute.get(Math.floor(c.at / 60000)) ?? 0) + 1);
    assert.ok(Math.max(...perMinute.values()) <= PER_MINUTE);
    for (let i = 1; i < w.calls.length; i++) assert.ok(w.calls[i].at - w.calls[i - 1].at >= 6500, 'minimum gap between requests');
    // A second run an hour later: no duplicate rows, unchanged records stay unchanged.
    const before = (await w.store.one("SELECT COUNT(*) n FROM fixtures WHERE provider='fivedollar'")).n;
    w.advance(3600000);
    const again = await w.service.sync('fivedollar');
    assert.equal((await w.store.one("SELECT COUNT(*) n FROM fixtures WHERE provider='fivedollar'")).n, before);
    assert.equal(again.inserted, 0);
  } finally { w.sqlite.close(); }
});

test('the run budget defers remaining work to the next run without failing', async () => {
  const w = await world();
  try {
    w.setFixtures([raw(21, 'scheduled')]);
    const {syncFiveDollar: run} = await import('../../lib/football/fivedollar.mjs');
    const first = await run(w.service, {mode: 'core', budget: 2});
    assert.equal(first.requests, 2); assert.match(first.deferred, /budget/);
    assert.equal(first.errors.length, 0);
  } finally { w.sqlite.close(); }
});

test('Retry-After defers the run; repeated failures and authentication errors open the circuit', async () => {
  let mode = '429';
  const w = await world({respond: () => {
    if (mode === '429') return new Response('{"success":0,"error":{"code":"rate_limited"}}', {status: 429, headers: {'retry-after': '120'}});
    if (mode === '401') return new Response('{"success":0,"error":{"type":"authentication_error","code":"invalid_api_key"}}', {status: 401});
    return null;
  }});
  try {
    const limited = await syncFiveDollar(w.service, {mode: 'core'});
    assert.match(limited.deferred, /429/); assert.equal(w.calls.length, 1, 'no retry inside the Retry-After window');
    const registry = await w.store.one("SELECT next_allowed_at FROM source_registry WHERE id='fivedollar'");
    assert.ok(registry.next_allowed_at >= w.clock.now + 110000, 'Retry-After respected');
    w.advance(10 * 60000); mode = '401';
    const denied = await syncFiveDollar(w.service, {mode: 'core'});
    assert.match(denied.deferred, /401/);
    assert.ok(!JSON.stringify(denied).includes(SECRET));
    const calls = w.calls.length; w.advance(60 * 60000); mode = 'ok';
    const blocked = await syncFiveDollar(w.service, {mode: 'core'});
    assert.match(blocked.deferred, /Circuit open/); assert.equal(w.calls.length, calls, 'open circuit makes no requests');
    w.advance(6 * 3600000);
    const recovered = await syncFiveDollar(w.service, {mode: 'core'});
    assert.ok(w.calls.length > calls, 'circuit closes after the hold period'); assert.equal(recovered.errors.length, 0);
  } finally { w.sqlite.close(); }
});

test('linked records cross-check another provider: one forecast, graded from the confirmed result, stale data ignored', async () => {
  const w = await world({start: '2026-11-01T12:00:00Z'});
  try {
    await w.service.saveFixtures([1, 2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(5100 + i, 'FT', `2026-10-0${i}T12:00:00Z`))));
    const own = normalizeFixture('api-football', apiFixture(5200, 'NS', new Date(KICKOFF).toISOString()));
    await w.service.saveFixtures([own]);
    const lab = new ModelLab(w.service);
    assert.ok((await lab.capture(own)).forecasts > 0);
    // Same kickoff and teams from 5DollarFootballAPI; a women's fixture at the same time must not link.
    w.setFixtures([raw(31, 'scheduled'), raw(32, 'scheduled', {teams: {home: {id: 11, name: 'Team 10 Women'}, away: {id: 21, name: 'Team 20 Women'}}})]);
    w.clock.now = KICKOFF - 6 * 3600000;
    const linked = await syncFiveDollar(w.service, {mode: 'core'});
    assert.equal(linked.links.linked, 1, JSON.stringify(linked.links));
    const canonical = id => w.store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?', id);
    assert.equal((await canonical('fivedollar:31')).canonical_id, (await canonical(own.id)).canonical_id);
    assert.notEqual((await canonical('fivedollar:32')).canonical_id, (await canonical(own.id)).canonical_id);
    const fdfa = JSON.parse((await w.store.one("SELECT payload FROM fixtures WHERE id='fivedollar:31'")).payload);
    assert.equal((await lab.capture(fdfa)).state, 'skipped', 'no second forecast for the same match');
    // The result arrives from 5DollarFootballAPI only; the api-football forecast is graded from it.
    w.clock.now = KICKOFF + 3 * 3600000;
    w.setFixtures([raw(31, 'finished')]);
    await syncFiveDollar(w.service, {mode: 'core'});
    await lab.grade();
    const grades = await w.store.all('SELECT payload FROM analysis_grades WHERE fixture_id=?', own.id);
    assert.ok(grades.length > 0);
    for (const g of grades) { const p = JSON.parse(g.payload); assert.equal(p.homeScore, 2); assert.equal(p.resultSource, 'fivedollar'); }
    // A later stale in-play observation cannot replace the confirmed result.
    w.advance(3600000); w.setFixtures([raw(31, 'in_play')]);
    await syncFiveDollar(w.service, {mode: 'core'});
    assert.equal((await fixtureRow(w.store, 'fivedollar:31')).status, 'FT');
  } finally { w.sqlite.close(); }
});

test('details sync stores events, statistics with corners and cards, odds and provider standings', async () => {
  const w = await world();
  try {
    w.setFixtures([raw(41, 'finished', {kickoff_ts: Date.parse('2026-11-19T15:00:00Z') / 1000})]);
    await syncFiveDollar(w.service, {mode: 'core'});
    w.setStandings({league_id: 100, season: '2026', league_season_id: 9, type: 'total', round: 12, source: 'feed', table: [
      {position: 1, team: {id: 10, name: 'Team 10'}, played: 12, win: 9, draw: 2, lose: 1, goals_for: 25, goals_against: 8, goal_difference: 17, points: 29}]});
    w.advance(3 * 3600000);
    const result = await syncFiveDollar(w.service, {mode: 'details'});
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    const events = JSON.parse((await w.store.one("SELECT payload FROM fixture_events WHERE fixture_id='fivedollar:41'")).payload);
    assert.equal(events.length, 2); assert.equal(events[0].type, 'Goal'); assert.equal(events[0].team.id, 'fivedollar:t10');
    const stats = JSON.parse((await w.store.one("SELECT payload FROM fixture_statistics WHERE fixture_id='fivedollar:41'")).payload);
    const home = Object.fromEntries(stats[0].statistics.map(s => [s.type, s.value]));
    assert.equal(home['Corner Kicks'], 5); assert.equal(home['Yellow Cards'], 2); assert.equal(home['Ball Possession'], '55%');
    assert.ok((await w.store.cache('odds:fivedollar:41')).data.markets['1x2']);
    assert.equal(result.standings, 1);
    const table = JSON.parse((await w.store.one("SELECT payload FROM standings WHERE season_id='fivedollar:l100:2026'")).payload);
    assert.equal(table.rows[0].points, 29); assert.equal(table.rows[0].team.id, 'fivedollar:t10');
    assert.equal(await dumpContains(w.sqlite, SECRET), null);
  } finally { w.sqlite.close(); }
});

test('standings normalization validates the envelope; jobs are scheduled hourly and three-hourly', () => {
  assert.throws(() => normalizeFdfaStandings({season: '2026'}), /envelope/);
  assert.ok(CRON_JOBS['0 * * * *'].includes('fivedollar'));
  assert.ok(CRON_JOBS['20 */3 * * *'].includes('fivedollar-details'));
  assert.ok(CRON_JOBS['0 * * * *'].indexOf('fivedollar') < CRON_JOBS['0 * * * *'].indexOf('models'), 'results confirmed before grading');
});

test('the competition page prefers the provider league table over the reconstructed one', async () => {
  const w = await world();
  try {
    w.setFixtures([raw(51, 'finished', {kickoff_ts: Date.parse('2026-11-19T15:00:00Z') / 1000})]);
    await syncFiveDollar(w.service, {mode: 'core'});
    const reconstructed = await w.service.competitionView('fivedollar:l100');
    assert.match(reconstructed.standings.label, /Reconstructed/);
    w.setStandings({league_id: 100, season: '2026', type: 'total', round: 12, table: [{position: 1, team: {id: 10, name: 'Team 10'}, played: 12, win: 9, draw: 2, lose: 1, goals_for: 25, goals_against: 8, goal_difference: 17, points: 29}]});
    w.advance(3 * 3600000);
    await syncFiveDollar(w.service, {mode: 'details'});
    const view = await w.service.competitionView('fivedollar:l100');
    assert.equal(view.standings.source, 'provider'); assert.equal(view.standings.season, '2026');
    assert.match(view.standings.label, /5DollarFootballAPI after round 12/);
    assert.deepEqual({w: view.standings.rows[0].wins, d: view.standings.rows[0].draws, l: view.standings.rows[0].losses, pts: view.standings.rows[0].points}, {w: 9, d: 2, l: 1, pts: 29});
  } finally { w.sqlite.close(); }
});

test('the live league catalog is mapped dynamically; unmapped provider leagues stay out of the public catalog', async () => {
  const {catalogCompetitions} = await import('../../lib/football/identity-migration.mjs');
  const w = await world();
  try {
    w.setFixtures([raw(61, 'finished', {kickoff_ts: Date.parse('2026-11-20T09:00:00Z') / 1000})]);
    const first = await syncFiveDollar(w.service, {mode: 'core'});
    assert.equal(first.catalog.total, LEAGUES.length, 'count comes from the provider response');
    const map = async () => new Map((await w.store.cache('fdfa:catalog-map')).data.rows.map(r => [r.providerLeagueId, r]));
    let rows = await map();
    assert.equal(rows.get(100).status, 'awaiting-identity-run');
    assert.equal(rows.get(200).status, 'awaiting-fixtures');
    assert.equal(rows.get(300).status, 'retired');
    for (const r of rows.values()) for (const k of ['providerLeagueId', 'providerName', 'country', 'available', 'lastObservedAt', 'status']) assert.ok(k in r, k);
    assert.ok(!(await catalogCompetitions(w.store)).some(c => c.providerIds.includes('fivedollar:l100')), 'not public before mapping');
    await w.service.sync('competition-identities');
    w.advance(3600000);
    const second = await syncFiveDollar(w.service, {mode: 'core'});
    rows = await map();
    assert.equal(rows.get(100).status, 'mapped-auto'); assert.match(rows.get(100).canonicalId, /^competition:/);
    assert.equal(second.catalog.mappedAuto, 1);
    assert.ok((await catalogCompetitions(w.store)).some(c => c.providerIds.includes('fivedollar:l100')), 'public once mapped');
    // An open identity review keeps the league out of the public catalog.
    await w.store.run("INSERT INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES('identity:competition-merge:fivedollar:l100','competition-merge','fivedollar:l100','https://example.invalid','{}','pending',0)");
    assert.ok(!(await catalogCompetitions(w.store)).some(c => c.providerIds.includes('fivedollar:l100')), 'ambiguous stays private');
  } finally { w.sqlite.close(); }
});

test('a network error that echoes the Authorization header is sanitized before it reaches results, logs or the database', async () => {
  const w = await world({respond: (_u, n) => { throw Object.assign(new Error(`connect failed; request headers: Authorization: Bearer ${SECRET}`), {headers: {authorization: `Bearer ${SECRET}`}}); }});
  const logged = [], original = console.log; console.log = (...a) => { logged.push(a.join(' ')); };
  try {
    const result = await syncFiveDollar(w.service, {mode: 'core'});
    console.log = original;
    assert.ok(result.deferred, 'the run stops instead of throwing');
    assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.ok(!logged.some(l => l.includes(SECRET)));
    assert.equal(await dumpContains(w.sqlite, SECRET), null);
  } finally { console.log = original; w.sqlite.close(); }
});
