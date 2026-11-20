// Result confirmation regression (production 2026-11-20: zero graded forecasts).
// OpenLigaDB's getlastchangedate/<league>/<season>/0 never changes, so finished Bundesliga results were never
// re-imported. Change detection now uses the season data; stale non-final observations cannot overwrite results.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {syncOpenLiga, openLigaChangeToken, normalizeOpenLiga} from '../../lib/football/openligadb.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';

const KICKOFF = '2026-11-08T18:30:00Z';
const match = (finished, update) => ({
  matchID: 83231, leagueShortcut: 'bl1', leagueSeason: 2026, matchDateTimeUTC: KICKOFF, group: {groupName: '9. Spieltag'},
  team1: {teamId: 175, teamName: 'TSG Hoffenheim'}, team2: {teamId: 9, teamName: 'FC Schalke 04'},
  lastUpdateDateTime: update, matchIsFinished: finished,
  matchResults: finished ? [{resultTypeKind: 'HalfTime', pointsTeam1: 2, pointsTeam2: 0}, {resultTypeKind: 'After90Minutes', pointsTeam1: 2, pointsTeam2: 1}] : [],
});

async function world() {
  const db = database(); let now = Date.parse('2026-11-01T12:00:00Z'); db.store.now = () => now;
  await db.store.init(); const service = new IntelligenceService(db.store); await service.initialize();
  let season = [match(false, '2026-09-02T15:36:25.313')]; const calls = [];
  service.http = {sleep: async () => {}, json: async (_provider, url) => { calls.push(url); if (url.includes('getlastchangedate')) return '2026-09-02T15:36:25.313'; return url.includes('/bl1/2026') ? season : []; }};
  return {...db, service, calls, at: t => { now = Date.parse(t); }, setSeason: s => { season = s; }};
}
const row = (store, id) => store.one('SELECT status,home_score,away_score FROM fixtures WHERE id=?', id);

test('change token follows per-match updates, not the static group-0 date', () => {
  const before = openLigaChangeToken([match(false, '2026-09-02T15:36:25.313')]);
  const after = openLigaChangeToken([match(true, '2026-11-08T21:42:05.193')]);
  assert.notEqual(before, after);
  assert.equal(openLigaChangeToken([match(true, '2026-11-08T21:42:05.193')]), after);
});

test('a finished OpenLigaDB result is re-imported after the cache expires; group 0 is never consulted', async () => {
  const w = await world();
  try {
    await syncOpenLiga(w.service);
    assert.equal((await row(w.store, 'openligadb:83231')).status, 'NS');
    w.setSeason([match(true, '2026-11-08T21:42:05.193')]);
    w.at('2026-11-08T23:00:00Z');
    await syncOpenLiga(w.service);
    assert.deepEqual({...await row(w.store, 'openligadb:83231')}, {status: 'FT', home_score: 2, away_score: 1}, 'regulation (After90Minutes) score');
    assert.equal(w.calls.filter(u => u.includes('getlastchangedate')).length, 0);
  } finally { w.sqlite.close(); }
});

test('a stale non-final observation never overwrites a confirmed final result; cancellation still applies', async () => {
  const w = await world();
  try {
    const finished = normalizeOpenLiga(match(true, '2026-11-08T21:42:05.193'), 'bl1', 2026);
    await w.service.saveFixtures([finished]);
    await w.service.saveFixtures([normalizeOpenLiga(match(false, '2026-09-02T15:36:25.313'), 'bl1', 2026)]);
    assert.equal((await row(w.store, finished.id)).status, 'FT');
    await w.service.saveFixtures([{...finished, status: 'FT', homeScore: 3, awayScore: 1}]);
    assert.equal((await row(w.store, finished.id)).home_score, 3, 'final-to-final correction applies');
    const generic = normalizeFixture('api-football', apiFixture(4001, 'FT', '2026-11-08T12:00:00Z'));
    await w.service.saveFixtures([generic]); await w.service.saveFixtures([{...generic, status: 'CANC', homeScore: null, awayScore: null}]);
    assert.equal((await row(w.store, generic.id)).status, 'CANC');
  } finally { w.sqlite.close(); }
});

test('the frozen pre-kickoff forecast is graded exactly once when the verified result arrives', async () => {
  const w = await world();
  try {
    // Evidence before kickoff, then a tracked forecast at 2026-11-01 for the 2026-11-08 match.
    await w.service.saveFixtures([1, 2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(4100 + i, 'FT', `2026-10-0${i}T12:00:00Z`))));
    const upcoming = normalizeFixture('api-football', apiFixture(4200, 'NS', KICKOFF));
    await w.service.saveFixtures([upcoming]);
    const lab = new ModelLab(w.service);
    assert.ok((await lab.capture(upcoming)).forecasts > 0);
    const frozen = (await w.store.all('SELECT id,payload FROM analysis_forecasts WHERE fixture_id=?', upcoming.id));
    w.at('2026-11-08T23:00:00Z');
    await w.service.saveFixtures([{...upcoming, status: 'FT', homeScore: 2, awayScore: 1}]);
    await lab.grade();
    assert.equal((await w.store.one('SELECT COUNT(*) n FROM analysis_grades WHERE fixture_id=?', upcoming.id)).n, frozen.length, 'each frozen version graded');
    const audits = (await w.store.one('SELECT COUNT(*) n FROM analysis_grade_audit WHERE fixture_id=?', upcoming.id)).n;
    assert.equal(await lab.grade(), 0, 'grading the same verified result again changes nothing');
    assert.equal((await w.store.one('SELECT COUNT(*) n FROM analysis_grade_audit WHERE fixture_id=?', upcoming.id)).n, audits, 'regrading records nothing new');
    assert.equal((await w.store.one('SELECT COUNT(*) n FROM analysis_grades WHERE fixture_id=?', upcoming.id)).n, frozen.length);
    assert.deepEqual((await w.store.all('SELECT id,payload FROM analysis_forecasts WHERE fixture_id=?', upcoming.id)), frozen, 'forecast never rewritten');
  } finally { w.sqlite.close(); }
});
