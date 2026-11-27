// Basketball: BALLDONTLIE normalisation, persistence rules, the basketball model, predictions, grading and views.
// Game objects follow the documented BALLDONTLIE shape; the data here is isolated test data, never production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeGame, gameStatus, saveGames, syncBasketball, recentSeasons} from '../../lib/basketball/balldontlie.mjs';
import {replay, features, evaluate, predict, fitCalibration} from '../../lib/basketball/model.mjs';
import {basketballStage, basketballView, basketballGame} from '../../lib/basketball/service.mjs';

const team = (id, name, abbr, conference = 'East') => ({id, full_name: name, name, abbreviation: abbr, city: name, conference, division: 'Atlantic'});
const T = [team(1, 'Alpha', 'ALP'), team(2, 'Bravo', 'BRV'), team(3, 'Charlie', 'CHA', 'West'), team(4, 'Delta', 'DEL', 'West')];
const bdl = (id, iso, h, a, hs, as, extra = {}) => ({id, date: iso.slice(0, 10), datetime: iso, season: extra.season ?? 2024, status: hs == null ? iso : 'Final', period: hs == null ? 0 : 4, time: hs == null ? '' : 'Final', postseason: false,
  home_team_score: hs ?? 0, visitor_team_score: as ?? 0, home_q1: hs == null ? null : Math.floor(hs / 4), home_q2: hs == null ? null : Math.floor(hs / 4), home_q3: null, home_q4: null, visitor_q1: as == null ? null : Math.floor(as / 4), visitor_q2: as == null ? null : Math.floor(as / 4), visitor_q3: null, visitor_q4: null,
  home_team: T[h - 1], visitor_team: T[a - 1], ...extra});

test('status and scores come from the provider fields; scheduled games carry no score', () => {
  assert.equal(gameStatus({status: 'Final'}).status, 'FT');
  assert.equal(gameStatus({status: '3rd Qtr', period: 3, time: '5:12'}).status, 'LIVE');
  assert.equal(gameStatus({status: 'Halftime', period: 2}).status, 'HT');
  assert.equal(gameStatus({status: '2026-11-28T00:30:00Z', period: 0}).status, 'NS');
  const ns = normalizeGame(bdl(10, '2026-11-28T00:30:00Z', 1, 2), 0), p = JSON.parse(ns.payload);
  assert.equal(p.homeScore, null); assert.equal(p.timeKnown, true); assert.equal(ns.home_team_id, 'balldontlie:nba:1');
  const ft = JSON.parse(normalizeGame(bdl(11, '2026-11-20T00:30:00Z', 1, 2, 110, 101), 0).payload);
  assert.deepEqual([ft.homeScore, ft.awayScore, ft.quarters.home[0]], [110, 101, 27]);
});

async function world(env = {}, fetcher) {
  const db = database(); let now = Date.parse('2026-11-27T12:00:00Z'); db.store.now = () => now; await db.store.init();
  const service = new IntelligenceService(db.store, env, fetcher ? {fetcher, sleep: async () => {}} : {}); await service.initialize();
  return {...db, service, at: t => { now = t; }};
}

test('a recorded final is never replaced by a later non-final observation', async () => {
  const w = await world();
  try {
    await saveGames(w.store, [normalizeGame(bdl(20, '2026-11-26T00:00:00Z', 1, 2, 100, 90), w.store.now())]);
    await saveGames(w.store, [normalizeGame({...bdl(20, '2026-11-26T00:00:00Z', 1, 2), status: '4th Qtr', period: 4, home_team_score: 95, visitor_team_score: 88}, w.store.now())]);
    assert.equal((await w.store.one("SELECT status,home_score FROM basketball_games WHERE id='balldontlie:20'")).home_score, 100);
  } finally { w.sqlite.close(); }
});

/** Two synthetic seasons where team strength is real: the model must learn it chronologically. */
function seasons() {
  const out = []; let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, str = {1: 6, 2: 2, 3: -2, 4: -6};
  let t = Date.parse('2023-10-20T00:00:00Z'), id = 1000;
  for (const season of [2023, 2024]) for (let i = 0; i < 420; i++) {
    const h = 1 + Math.floor(rnd() * 4); let a = 1 + Math.floor(rnd() * 4); if (a === h) a = (a % 4) + 1;
    const margin = Math.round(str[h] - str[a] + 2.5 + (rnd() - 0.5) * 24), base = 105 + Math.round((rnd() - 0.5) * 20);
    const hs = base + Math.max(1, margin);
    out.push(JSON.parse(normalizeGame(bdl(id++, new Date(t).toISOString(), h, a, margin > 0 ? hs : base, margin > 0 ? base : base - margin + 1, {season}), 0).payload)); t += 6 * 3600000;
  }
  return out;
}

test('chronological evaluation: fitted on the first season, scored on later games, learns real strength without leakage', () => {
  const games = seasons(), ev = evaluate(games);
  assert.equal(ev.state, 'evaluated'); assert.equal(ev.trainSeason, 2023); assert.deepEqual(ev.testSeasons, [2024]);
  assert.ok(ev.winner.n > 300 && ev.winner.accuracy > 0.6, `accuracy ${ev.winner.accuracy}`);
  assert.ok(ev.winner.brier < 0.25, 'better than a coin flip'); assert.ok(ev.marginMae > 0 && ev.totalMae > 0);
  assert.equal(ev.shadowBackToBack.promoted, false);
  // Features for a game never include that game's own result.
  const g = games[500]; let seen;
  replay(games, (st, x) => { if (x.id === g.id) seen = features(st, x); });
  const tampered = games.map(x => x.id === g.id ? {...x, homeScore: 999} : x); let again;
  replay(tampered, (st, x) => { if (x.id === g.id) again = features(st, x); });
  assert.deepEqual(seen, again);
});

test('predictions: winner, margin, totals and first half with ranges; unavailable without history', () => {
  const games = seasons(), rows = []; replay(games.filter(x => x.season === 2023), (st, x) => rows.push({f: features(st, x), game: x}));
  const cal = fitCalibration(rows), st = replay(games), f = features(st, {home: {id: 'balldontlie:nba:1'}, away: {id: 'balldontlie:nba:4'}, startsAt: Date.parse('2026-01-01')});
  const p = predict(f, cal);
  assert.equal(p.state, 'ok'); assert.ok(p.winner.home > 0.6, 'strongest team at home is favoured'); assert.ok(Math.abs(p.winner.home + p.winner.away - 1) < 1e-12);
  assert.ok(p.margin.range[0] < p.margin.expected && p.total.range[1] > p.total.expected && p.firstHalf);
  assert.equal(predict(features(replay([]), {home: {id: 'x'}, away: {id: 'y'}, startsAt: 0}), cal).state, 'unavailable');
});

test('stage: sync through the provider, immutable pre-game predictions, idempotent grading, standings view', async () => {
  const history = seasons(), calls = [];
  const fetcher = async url => { const u = new URL(url); calls.push(u.pathname + u.search);
    if (u.pathname.endsWith('/teams')) return Response.json({data: T});
    if (u.searchParams.get('seasons[]')) return Response.json({data: [], meta: {}});
    return Response.json({data: [bdl(9001, '2026-11-28T00:30:00Z', 1, 4, null, null, {season: 2026}), bdl(9002, '2026-11-26T00:30:00Z', 2, 3, 104, 99, {season: 2026})], meta: {}}); };
  const w = await world({BALLDONTLIE_API_KEY: 'bdl-test-key'}, fetcher);
  try {
    for (const g of history) await w.store.upsert('basketball_games', {id: g.id, provider: 'balldontlie', external_id: g.id, league: 'NBA', season: g.season, starts_at: g.startsAt, status: g.status, period: 4, home_team_id: g.home.id, away_team_id: g.away.id, home_score: g.homeScore, away_score: g.awayScore, postseason: 0, payload: JSON.stringify(g), updated_at: 0});
    const r = await basketballStage(w.service);
    assert.equal(r.sync.teams, 4); assert.ok(calls.every(c => !c.includes('bdl-test-key')), 'key only in the header');
    assert.equal(r.predictions, 1, 'one prediction for the upcoming game');
    const pred = await w.store.one("SELECT created_at,starts_at FROM basketball_predictions WHERE game_id='balldontlie:9001'");
    assert.ok(Number(pred.created_at) < Number(pred.starts_at));
    assert.equal((await basketballStage(w.service)).predictions, 0, 'not predicted twice');
    // The game finishes: graded once.
    w.at(Date.parse('2026-11-28T04:00:00Z'));
    await saveGames(w.store, [normalizeGame(bdl(9001, '2026-11-28T00:30:00Z', 1, 4, 118, 101, {season: 2026}), w.store.now())]);
    await basketballStage(w.service); await basketballStage(w.service);
    assert.equal(Number((await w.store.one('SELECT COUNT(*) n FROM basketball_grades')).n), 1);
    const v = await basketballView(w.service);
    assert.equal(v.configured, true); assert.ok(v.historicalGames >= 840); assert.ok(v.standings.length === 2);
    assert.equal(v.evaluation.state, 'evaluated');
    const g = await basketballGame(w.service, 'balldontlie:9001');
    assert.equal(g.grade.winnerCorrect, true); assert.equal(g.form.home.length, 5);
  } finally { w.sqlite.close(); }
});

test('without a key nothing is requested and the page states it honestly; the public page uses no demo data', async () => {
  let calls = 0; const w = await world({}, async () => { calls++; return Response.json({}); });
  try {
    assert.equal((await syncBasketball(w.service)).state, 'disabled'); assert.equal(calls, 0);
    const v = await basketballView(w.service); assert.equal(v.configured, false); assert.equal(v.historicalGames, 0);
  } finally { w.sqlite.close(); }
  const page = readFileSync(new URL('../../app/basketball/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /demo/i);
});

test('limiter: concurrent callers across workers never get more than 5 BALLDONTLIE slots in one minute', async () => {
  const {reserveMinute} = await import('../../lib/basketball/balldontlie.mjs');
  const w = await world();
  try {
    const got = await Promise.all(Array.from({length: 12}, () => reserveMinute(w.store)));
    assert.equal(got.filter(Boolean).length, 5);
    w.at(Date.parse('2026-11-27T12:01:00Z')); assert.equal(await reserveMinute(w.store), true, 'next minute opens');
  } finally { w.sqlite.close(); }
});

test('NBA starting five: confirmed needs exactly 5 distinct starters per team; NBA games join the shared research window', async () => {
  const {validateFixtureResult, researchUpcoming, spent} = await import('../../lib/football/openai-research.mjs');
  const SRC = 'https://www.nba.example/news/starters', now = Date.parse('2026-11-27T12:00:00Z');
  const five = p => Array.from({length: 5}, (_, i) => ({name: `${p} ${i}`}));
  const f = {id: 'balldontlie:1', startsAt: now + 3600000, sport: 'basketball'}, cited = new Set([SRC]);
  assert.equal(validateFixtureResult({lineup: {status: 'confirmed', source_url: SRC, published_at: new Date(now).toISOString(), home: {starters: five('H')}, away: {starters: five('A')}}}, f, cited, now).lineup.status, 'confirmed');
  assert.equal(validateFixtureResult({lineup: {status: 'confirmed', source_url: SRC, published_at: new Date(now).toISOString(), home: {starters: [...five('H'), {name: 'H 9'}]}, away: {starters: five('A')}}}, f, cited, now).lineup.status, 'predicted', 'six starters is not a confirmed five');
  const prompts = [];
  const w = await world({OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'sk-test', OPENAI_MAX_REQUESTS_PER_RUN: '1'}, async (url, init) => { const b = JSON.parse(init.body); prompts.push(b.input); const ids = b.input.match(/id=([^ ]+)/g).map(x => x.slice(3)); return Response.json({usage: {input_tokens: 9000, output_tokens: 500}, output: [{type: 'web_search_call', action: {type: 'search'}}, {type: 'message', content: [{type: 'output_text', text: JSON.stringify({fixtures: ids.map(id => ({id, lineup: {status: 'confirmed', source_url: SRC, published_at: new Date(now).toISOString(), home: {starters: five('H')}, away: {starters: five('A')}}}))}), annotations: [{type: 'url_citation', url: SRC}]}]}]}); });
  try {
    await saveGames(w.store, [normalizeGame(bdl(7100, '2026-11-27T13:00:00Z', 1, 2, null, null, {season: 2026}), now)]);
    const r = await researchUpcoming(w.service);
    assert.equal(r.requests, 1); assert.match(prompts[0], /basketball/); assert.match(prompts[0], /starting five/);
    assert.equal((await w.store.cache('research:balldontlie:7100')).data.lineup.status, 'confirmed');
    assert.ok(await spent(w.store) > 0, 'charged to the shared ledger');
  } finally { w.sqlite.close(); }
});

test('basketball shadow: the per-absence effect is fitted on earlier games and scored on later ones; production unchanged', async () => {
  const {evaluateBasketballShadow} = await import('../../lib/basketball/shadow.mjs');
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, rows = [];
  for (let i = 0; i < 400; i++) { const d = rnd() < 0.4 ? (rnd() < 0.5 ? 2 : -2) : 0, p = 0.6, truth = 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) - 0.25 * d))); rows.push({tipoff: i, pHome: p, absentDiff: d, doubtfulDiff: 0, homeWon: rnd() < truth}); }
  const ev = evaluateBasketballShadow(rows);
  assert.equal(ev.state, 'evaluated'); assert.ok(ev.availability.coefficients.perAbsence < 0, 'absences of the home side lower its chance');
  assert.equal(ev.availability.coefficients.perDoubtful, 0, 'a feature that never varies gets no effect'); assert.equal(ev.production, 'unchanged until promotion criteria pass');
  assert.equal(evaluateBasketballShadow(rows.slice(0, 50)).state, 'collecting');
});

test('Gemini NBA analysis uses only recorded facts (no grounding)', async () => {
  const {basketballFacts} = await import('../../lib/basketball/service.mjs');
  const {validateExplanation} = await import('../../lib/football/gemini-intelligence.mjs');
  const g = JSON.parse(normalizeGame(bdl(7200, '2026-11-28T00:30:00Z', 1, 2), 0).payload), p = {winner: {home: 0.64, away: 0.36}, margin: {expected: 4.6}, total: {expected: 224.3}, context: {backToBack: {home: false, away: true}}};
  const facts = basketballFacts(g, p, null, {form: {home: [{for: 110, against: 100}], away: []}, homeRecord: {w: 8, l: 3}, awayRecord: {w: 4, l: 6}});
  assert.ok(facts.find(f => f.id === 'p_home').value === 64 && facts.find(f => f.id === 'away_back_to_back').value === 'yes');
  assert.equal(validateExplanation({points: [{text: 'Alpha are 64 percent favourites at home.', facts: ['p_home']}]}, facts).points.length, 1);
  assert.match(validateExplanation({points: [{text: 'Alpha shoot 48 percent from the field.', facts: ['p_home']}]}, facts).error, /Number 48/);
});

test('history covers the current NBA season, labelled by its October start year', () => {
  assert.deepEqual(recentSeasons(Date.parse('2026-11-27T03:00:00Z')), [2023, 2024, 2025, 2026]);
  assert.deepEqual(recentSeasons(Date.parse('2027-03-01T00:00:00Z')), [2023, 2024, 2025, 2026]);
  assert.deepEqual(recentSeasons(Date.parse('2027-10-20T00:00:00Z')), [2024, 2025, 2026, 2027]);
});
