// Fixture dates, Live Scores board and the match event timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchdayRange, inMatchday} from '../../lib/football/matchday.mjs';
import {matchdayView} from '../../lib/football/recommendations.mjs';
import {classifyBoard, liveLabel, liveBoard, STALE_MS} from '../../lib/football/live-board.mjs';
import {matchTimeline, minuteText} from '../../lib/football/events.mjs';
import {fdfaDetails} from '../../lib/football/fivedollar.mjs';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';

const P = o => new URLSearchParams(o);
const NOW = Date.parse('2026-11-25T10:00:00Z');   // a Wednesday

test('date ranges: today, yesterday, tomorrow, this week (to Sunday) and custom ranges in the selected timezone', () => {
  const today = matchdayRange(P({timezone: 'UTC'}), NOW);
  assert.deepEqual([today.from, today.to], ['2026-11-25', '2026-11-25']);
  assert.equal(matchdayRange(P({day: 'yesterday', timezone: 'UTC'}), NOW).from, '2026-11-24');
  assert.equal(matchdayRange(P({day: 'tomorrow', timezone: 'UTC'}), NOW).from, '2026-11-26');
  const week = matchdayRange(P({day: 'thisweek', timezone: 'UTC'}), NOW); assert.deepEqual([week.from, week.to], ['2026-11-25', '2026-11-29']);
  const sunday = matchdayRange(P({day: 'thisweek', timezone: 'UTC'}), Date.parse('2026-11-29T12:00:00Z')); assert.deepEqual([sunday.from, sunday.to], ['2026-11-29', '2026-11-29']);
  // 23:30 UTC is already tomorrow in Dar es Salaam (UTC+3) and still today in New York.
  const late = Date.parse('2026-11-25T23:30:00Z');
  assert.equal(matchdayRange(P({timezone: 'Africa/Dar_es_Salaam'}), late).from, '2026-11-26');
  assert.equal(matchdayRange(P({timezone: 'America/New_York'}), late).from, '2026-11-25');
  const r = matchdayRange(P({timezone: 'Africa/Dar_es_Salaam'}), NOW);
  assert.equal(r.start, Date.parse('2026-11-24T21:00:00Z')); assert.equal(r.end, Date.parse('2026-11-25T21:00:00Z'));
  assert.ok(inMatchday({startsAt: Date.parse('2026-11-25T20:59:00Z')}, r) && !inMatchday({startsAt: Date.parse('2026-11-25T21:00:00Z')}, r), 'end boundary is exclusive');
  assert.throws(() => matchdayRange(P({day: 'custom', from: '2027-01-02', to: '2026-11-01', timezone: 'UTC'}), NOW), /ordered range/);
  assert.throws(() => matchdayRange(P({day: 'date', from: 'next year', timezone: 'UTC'}), NOW), /Invalid date/);
  assert.equal(matchdayRange(P({day: 'custom', from: '2027-01-02', to: '2027-01-03', timezone: 'UTC'}), NOW).from, '2027-01-02', 'future dates appear only when selected');
});

async function world() {
  const db = database(); db.store.now = () => NOW; await db.store.init();
  const service = new IntelligenceService(db.store); await service.initialize(); return {...db, service};
}

test("today's fixtures exclude next year's matches; competition and team filters combine with the date", async () => {
  const w = await world();
  try {
    await w.service.saveFixtures([
      normalizeFixture('api-football', apiFixture(5001, 'NS', '2026-11-25T18:00:00Z', 10, 20)),
      normalizeFixture('api-football', apiFixture(5002, 'NS', '2026-11-25T19:00:00Z', 30, 40)),
      normalizeFixture('api-football', apiFixture(5003, 'NS', '2027-11-25T18:00:00Z', 10, 20)),   // same date next year
      normalizeFixture('api-football', apiFixture(5004, 'NS', '2026-11-26T18:00:00Z', 10, 20))]);
    const today = await matchdayView(w.service, P({timezone: 'UTC'}));
    assert.deepEqual(today.fixtures.map(f => String(f.externalId)).sort(), ['5001', '5002']);
    assert.ok(today.fixtures.every(f => new Date(f.startsAt).getUTCFullYear() === 2026));
    const team = today.fixtures[0].home.name;
    const byTeam = await matchdayView(w.service, P({timezone: 'UTC', q: team.toLowerCase()}));
    assert.ok(byTeam.fixtures.length >= 1 && byTeam.fixtures.every(f => `${f.home.name} ${f.away.name}`.includes(team)));
    const comp = today.fixtures[0].competition.id;
    const both = await matchdayView(w.service, P({timezone: 'UTC', competition: comp, q: team.toLowerCase()}));
    assert.ok(both.fixtures.length >= 1 && both.fixtures.every(f => f.competition.id === comp && new Date(f.startsAt).toISOString().startsWith('2026-11-25')));
    const empty = await matchdayView(w.service, P({day: 'date', from: '2026-12-25', timezone: 'UTC'}));
    assert.equal(empty.count, 0, 'an empty date stays empty; nothing is substituted');
  } finally { w.sqlite.close(); }
});

test('live board: live, half-time and finished sections; stale and offline states; old live statuses are not live', () => {
  const f = (id, status, minsAgo, elapsed) => ({id, status, startsAt: NOW - minsAgo * 60000, elapsed});
  const fixtures = [f('a', '1H', 30, 30), f('b', 'HT', 50, null), f('c', 'FT', 150, 90), f('d', '2H', 300, 88), f('e', 'NS', -60)];
  const fresh = classifyBoard(fixtures, NOW, {lastUpdate: NOW - 30000});
  assert.deepEqual(fresh.live.map(x => x.id), ['b', 'a']); assert.deepEqual(fresh.finished.map(x => x.id), ['c']);
  assert.equal(fresh.unconfirmed, 1); assert.equal(fresh.state, 'fresh');
  assert.equal(classifyBoard(fixtures, NOW, {lastUpdate: NOW - STALE_MS - 1000}).state, 'stale');
  assert.equal(classifyBoard(fixtures, NOW, {lastUpdate: null}).state, 'offline');
  // Per-source freshness: a match from a feed that stopped updating is listed as delayed, never as live.
  const mixed = classifyBoard([{...f('x', '2H', 60, 70), provider: 'fivedollar'}, {...f('y', '2H', 60, 70), provider: 'livescore'}], NOW, {lastUpdate: NOW - 20000, sources: {fivedollar: NOW - 20000, livescore: null}});
  assert.deepEqual([mixed.live.map(x => x.id), mixed.delayed.map(x => x.id), mixed.state], [['x'], ['y'], 'fresh']);
  assert.equal(liveLabel(f('a', '1H', 30, 30)), '30′'); assert.equal(liveLabel(f('b', 'HT', 50, null)), 'Half-time');
  assert.equal(liveLabel({status: 'PEN'}), 'After penalties'); assert.equal(liveLabel({status: '2H'}), 'In progress', 'no manufactured minute');
});

test('live board moves a match from live to recently finished when the stored status changes', async () => {
  const w = await world();
  try {
    const base = normalizeFixture('api-football', apiFixture(6001, '2H', '2026-11-25T08:30:00Z', 10, 20));
    await w.service.saveFixtures([{...base, elapsed: 80}]);
    await w.store.putCache('live:fdfa:tick', {observedAt: NOW - 20000}, 86400000);
    await w.store.putCache('live:worker', {state: 'success', at: NOW - 20000}, 86400000);
    let b = await liveBoard(w.service);
    assert.deepEqual([b.live.length, b.finished.length, b.state], [1, 0, 'fresh']);
    await w.service.saveFixtures([{...base, status: 'FT', elapsed: 90}]);
    b = await liveBoard(w.service);
    assert.deepEqual([b.live.length, b.finished.length], [0, 1]);
  } finally { w.sqlite.close(); }
});

const FX = {id: 'fivedollar:1', home: {id: 'fivedollar:t1', name: 'Catanzaro'}, away: {id: 'fivedollar:t2', name: 'Bari'}};
test('timeline: chronological, stable ids, duplicates removed, no invented scorers, shoot-out kept separate', () => {
  const rows = [
    {providerType: 'goal', type: 'Goal', minute: 50, team: FX.home, player: null, count: 2},
    {providerType: 'goal', type: 'Goal', minute: 28, team: FX.home, player: null, count: 1},
    {providerType: 'goal', type: 'Goal', minute: 28, team: FX.home, player: null, count: 1},   // duplicate delivery
    {providerType: 'corner', type: 'Corner', minute: 10, team: FX.away},
    {providerType: 'period_score', type: 'Period score', detail: 'first_half', score: {home: 1, away: 0}},
    {providerType: 'substitution', type: 'Substitution', minute: 46, team: FX.away, player: 'Ruggero', playerOut: 'Frosinini'},
    {providerType: 36, type: 'Provider event 36', minute: 12},   // undocumented code
  ];
  const t = matchTimeline(rows, FX);
  assert.deepEqual(t.events.map(e => [e.kind, e.minute]), [['goal', 28], ['period', null], ['substitution', 46], ['goal', 50]]);
  assert.equal(t.omitted, 1); assert.equal(t.events[0].player, null, 'scorer never inferred');
  assert.equal(new Set(t.events.map(e => e.id)).size, t.events.length);
  assert.deepEqual(matchTimeline([...rows].reverse(), FX).events.map(e => e.id).sort(), t.events.map(e => e.id).sort(), 'ids do not depend on order');
  // A correction: the provider drops the 50th-minute goal.
  assert.equal(matchTimeline(rows.filter(r => r.minute !== 50), FX).events.filter(e => e.kind === 'goal').length, 1);
  // API-Football: added time, own goal, VAR disallowal and a shoot-out.
  const af = [
    {time: {elapsed: 45, extra: 2}, team: {id: 'fivedollar:t1'}, player: {name: 'A'}, type: 'Goal', detail: 'Normal Goal'},
    {time: {elapsed: 47, extra: null}, team: {id: 'fivedollar:t1'}, type: 'Var', detail: 'Goal cancelled'},
    {time: {elapsed: 60}, team: {id: 'fivedollar:t2'}, player: {name: 'B'}, type: 'Goal', detail: 'Own Goal'},
    {time: {elapsed: 120}, team: {id: 'fivedollar:t2'}, player: {name: 'C'}, type: 'Goal', detail: 'Penalty', comments: 'Penalty Shootout'},
  ];
  const a = matchTimeline(af, FX);
  assert.equal(minuteText(a.events[0]), '45+2′'); assert.ok(a.events[0].disallowed);
  assert.equal(a.events.find(e => e.kind === 'own-goal').side, 'away');
  assert.deepEqual(a.shootout.map(e => e.kind), ['shootout-scored']); assert.ok(!a.events.some(e => e.shootout));
  assert.equal(matchTimeline([], FX).available, false);
});

test('5DollarFootballAPI event ids do not depend on list position', () => {
  const ev = [{type: 'goal', minute: 28, team: 'home', count: 1}, {type: 'yellow_card', minute: 30, team: 'away'}];
  const a = fdfaDetails({events: ev}, FX).events.map(e => e.id), b = fdfaDetails({events: [{type: 'corner', minute: 5, team: 'home'}, ...ev]}, FX).events.map(e => e.id);
  assert.deepEqual(b.slice(1), a);
});

test('public read-only board is shared for 15 s within a process', async () => {
  let reads = 0;
  const store = {readOnly: true, db: {}, now: () => NOW, all: async sql => { if (sql.startsWith("SELECT payload FROM fixtures")) reads++; return []; }, cache: async () => null};
  const service = {store, deduplicateFixtures: async f => f};
  const [a, b] = await Promise.all([liveBoard(service), liveBoard(service)]); await liveBoard(service);
  assert.equal(a, b); assert.equal(reads, 1, 'one fixtures query for concurrent and repeated visitors');
});
