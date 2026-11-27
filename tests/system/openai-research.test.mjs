// OpenAI pre-match research: budget ledger, billed-search accounting, validation, delta merge and scheduling.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {openaiState, worstCase, actualCost, reserve, settle, spent, validateFixtureResult, mergeResearch, researchBatch, researchUpcoming} from '../../lib/football/openai-research.mjs';
import {intelligenceStatus} from '../../lib/football/intelligence-status.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const ENV = {OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'sk-test-not-real', OPENAI_MODEL: 'gpt-4o-mini'};
const xi = p => Array.from({length: 11}, (_, i) => ({name: `${p} Player ${i + 1}`, number: i + 1, position: i ? 'MF' : 'GK'}));
const SRC = 'https://www.club.example/news/team-news';

test('off unless enabled with a key and a priced model; the budget is capped at $5', () => {
  assert.equal(openaiState({}).enabled, false);
  assert.match(openaiState({...ENV, OPENAI_MODEL: 'gpt-unknown'}).reason, /no recorded price/);
  assert.equal(openaiState({...ENV, OPENAI_BUDGET_USD: '50'}).budget, 5, 'never above the authorised $5');
  const st = openaiState(ENV); assert.ok(worstCase(st, 800) > 3 * 0.01, 'worst case covers every allowed search');
  assert.ok(Math.abs(actualCost('gpt-4o-mini', {input_tokens: 24000, output_tokens: 1000}, 3) - (0.03 + 24000 * 0.15e-6 + 1000 * 0.6e-6)) < 1e-9);
});

async function world(env, fetcher) {
  const db = database(); let t = NOW; db.store.now = () => t; await db.store.init();
  const service = new IntelligenceService(db.store, env, {fetcher, sleep: async () => {}}); await service.initialize();
  return {...db, service, advance: ms => { t += ms; }};
}

test('budget ledger: concurrent reservations never pass the cap; settlement records the actual cost', async () => {
  const w = await world({});
  try {
    const results = await Promise.all(Array.from({length: 20}, () => reserve(w.store, 0.3, 5)));
    assert.equal(results.filter(Boolean).length, 16, '16 × $0.30 fits under $5; the 17th does not');
    await settle(w.store, 0.3, 0.05);
    assert.ok(Math.abs(await spent(w.store) - (4.8 - 0.25)) < 1e-6);
  } finally { w.sqlite.close(); }
});

test('validation: confirmed needs 11 distinct starters per team and a cited source for this match; uncited claims are dropped', () => {
  const f = {id: 'fx1', startsAt: NOW + 3600000}, cited = new Set([SRC]);
  const good = validateFixtureResult({id: 'fx1', lineup: {status: 'confirmed', source_url: SRC, published_at: new Date(NOW).toISOString(), home: {formation: '4-3-3', starters: xi('H')}, away: {starters: xi('A')}}}, f, cited, NOW);
  assert.equal(good.lineup.status, 'confirmed');
  const dup = validateFixtureResult({id: 'fx1', lineup: {status: 'confirmed', source_url: SRC, published_at: new Date(NOW).toISOString(), home: {starters: [...xi('H').slice(0, 10), {name: 'H Player 1'}]}, away: {starters: xi('A')}}}, f, cited, NOW);
  assert.equal(dup.lineup.status, 'predicted', 'duplicate player: never confirmed');
  const old = validateFixtureResult({id: 'fx1', lineup: {status: 'confirmed', source_url: SRC, published_at: '2026-11-20T12:00:00Z', home: {starters: xi('H')}, away: {starters: xi('A')}}}, f, cited, NOW);
  assert.equal(old.lineup.status, 'predicted', 'a lineup from days before (an earlier match) is not confirmed');
  const uncited = validateFixtureResult({id: 'fx1', lineup: {status: 'confirmed', source_url: 'https://elsewhere.example/x', published_at: new Date(NOW).toISOString(), home: {starters: xi('H')}, away: {starters: xi('A')}}, availability: [{team: 'home', player: 'X', status: 'injured', source_url: 'https://not-cited.example'}]}, f, cited, NOW);
  assert.equal(uncited.lineup.status, 'not_announced'); assert.equal(uncited.availability.length, 0);
  assert.equal(validateFixtureResult(undefined, f, cited, NOW).lineup.status, 'not_announced', 'missing fixture stays unannounced');
});

test('delta merge: confirmed beats predicted, newer availability wins, nothing is lost when a later search finds less', () => {
  const prev = {fixtureId: 'fx1', lineup: {status: 'confirmed', source: SRC}, availability: [{team: 'home', player: 'Ana Silva', status: 'doubtful', publishedAt: 1}], circumstances: [], verifiedAt: 1};
  const next = {fixtureId: 'fx1', lineup: {status: 'predicted', source: SRC}, availability: [{team: 'home', player: 'Ana Silva', status: 'available_again', publishedAt: 2}], circumstances: [], rejected: []};
  const m = mergeResearch(prev, next, 5);
  assert.equal(m.lineup.status, 'confirmed'); assert.equal(m.availability[0].status, 'available_again'); assert.equal(m.verifiedAt, 5);
});

const responseFor = (ids, {searches = 2, lineup} = {}) => ({id: 'resp_1', usage: {input_tokens: 9000, output_tokens: 800}, output: [
  ...Array.from({length: searches}, () => ({type: 'web_search_call', status: 'completed', action: {type: 'search', query: 'team news'}})),
  {type: 'message', content: [{type: 'output_text', text: JSON.stringify({fixtures: ids.map(id => ({id, lineup: lineup ?? {status: 'not_announced'}, availability: [{team: 'away', player: 'Ben Okoro', status: 'suspended', source_url: SRC, published_at: new Date(NOW - 3600000).toISOString()}]}))}), annotations: [{type: 'url_citation', url: SRC}]}]}]});

test('one batched request researches several fixtures, counts billed searches and records the actual cost', async () => {
  const calls = [];
  const w = await world(ENV, async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json(responseFor(JSON.parse(init.body).input.match(/id=([^ ]+)/g).map(x => x.slice(3)))); });
  try {
    const fx = [1, 2, 3].map(i => normalizeFixture('api-football', apiFixture(7700 + i, 'NS', '2026-11-27T19:00:00Z', 10 + i, 20 + i)));
    const r = await researchBatch(w.service, fx);
    assert.equal(r.state, 'ok'); assert.equal(calls.length, 1, 'one request for three fixtures');
    assert.deepEqual(calls[0].tools, [{type: 'web_search', search_context_size: 'low'}]); assert.equal(calls[0].max_tool_calls, 3); assert.equal(calls[0].store, false);
    assert.deepEqual(calls[0].include, ['web_search_call.action.sources'], 'search sources are requested so citations can be verified');
    assert.equal(r.record.searches, 2); assert.ok(r.record.actualUsd < r.record.estimatedUsd, 'reservation covered the actual cost');
    assert.ok(Math.abs(await spent(w.store) - r.record.actualUsd) < 1e-6, 'ledger holds the actual cost, not the reservation');
    assert.equal(r.results.every(x => x.availability[0].status === 'suspended'), true);
  } finally { w.sqlite.close(); }
});

test('rolling stage: imminent lineups first, per-run and budget limits, research stored per fixture, no probability change', async () => {
  let n = 0;
  const w = await world({...ENV, OPENAI_MAX_REQUESTS_PER_RUN: '1'}, async (url, init) => { n++; const body = JSON.parse(init.body); const ids = body.input.match(/id=([^ ]+)/g).map(x => x.slice(3)); return Response.json(responseFor(ids, {lineup: body.input.includes('officially announced') ? {status: 'confirmed', source_url: SRC, published_at: new Date(NOW).toISOString(), home: {starters: xi('H')}, away: {starters: xi('A')}} : undefined})); });
  try {
    const soon = normalizeFixture('api-football', apiFixture(7801, 'NS', '2026-11-27T13:00:00Z', 31, 32));
    const later = [2, 3, 4, 5].map(i => normalizeFixture('api-football', apiFixture(7800 + i, 'NS', '2026-11-28T15:00:00Z', 40 + i, 50 + i)));
    await w.service.saveFixtures([soon, ...later]);
    const r = await researchUpcoming(w.service);
    assert.equal(r.requests, 1); assert.equal(r.stopped, 'per-run limit');
    const first = (await w.store.cache(`research:${soon.id}`)).data;
    assert.equal(first.lineup.status, 'confirmed', 'the match kicking off within 100 minutes was researched first for its lineup');
    assert.equal(r.confirmed, 1);
    const st = await intelligenceStatus(w.service);
    assert.equal(st.openai.requests, 1); assert.equal(st.openai.billedSearches, 2); assert.ok(st.openai.remainingUsd < 5);
    assert.doesNotMatch(JSON.stringify(st), /sk-test-not-real/);
    // Budget exhausted: no request is sent and the stage stops cleanly.
    await w.store.run("UPDATE source_request_usage SET used=? WHERE source_id='openai' AND day='spend-total-usd-micro'", 5e6); const before = n;
    w.advance(3600000);
    const r2 = await researchUpcoming(w.service); assert.equal(r2.stopped, 'total budget'); assert.equal(n, before);
  } finally { w.sqlite.close(); }
});

test('ambiguous failures keep the worst case as spent and are never retried; 4xx releases the reservation', async () => {
  let calls = 0;
  const w = await world(ENV, async () => { calls++; return new Response('{"error":{"message":"server"}}', {status: 503}); });
  try {
    const fx = [normalizeFixture('api-football', apiFixture(7901, 'NS', '2026-11-27T19:00:00Z', 61, 62))];
    const r = await researchBatch(w.service, fx);
    assert.equal(r.state, 'ambiguous'); assert.equal(calls, 1, 'no automatic retry of a possibly billed request');
    assert.ok(Math.abs(await spent(w.store) - r.record.estimatedUsd) < 1e-6, 'the full worst case is counted');
  } finally { w.sqlite.close(); }
  const w2 = await world(ENV, async () => new Response('{"error":{"message":"bad"}}', {status: 400}));
  try {
    const r = await researchBatch(w2.service, [normalizeFixture('api-football', apiFixture(7902, 'NS', '2026-11-27T19:00:00Z', 63, 64))]);
    assert.equal(r.state, 'error'); assert.equal(await spent(w2.store), 0, 'a rejected request costs nothing');
  } finally { w2.sqlite.close(); }
  const w3 = await world(ENV, async () => { throw new TypeError('socket hang up'); });
  try {
    const r = await researchBatch(w3.service, [normalizeFixture('api-football', apiFixture(7903, 'NS', '2026-11-27T19:00:00Z', 65, 66))]);
    assert.equal(r.state, 'ambiguous'); assert.ok(await spent(w3.store) > 0, 'a lost connection is counted at worst case');
  } finally { w3.sqlite.close(); }
});

test('batch sizes 5, 10 and 20 are each tried, then the most enriched fixtures per dollar wins', async () => {
  const {chooseBatchSize} = await import('../../lib/football/openai-research.mjs');
  assert.equal(chooseBatchSize({}), 5);
  assert.equal(chooseBatchSize({5: {requests: 2}}), 10);
  assert.equal(chooseBatchSize({5: {requests: 2}, 10: {requests: 2}}), 20);
  const stats = {5: {requests: 2, fixtures: 10, enriched: 9, usd: 0.08}, 10: {requests: 2, fixtures: 20, enriched: 16, usd: 0.09}, 20: {requests: 2, fixtures: 40, enriched: 12, usd: 0.1}};
  assert.equal(chooseBatchSize(stats), 10, '20 enriches under half; 10 beats 5 per dollar');
});

test('a source matches the search results despite www, utm_source and trailing-slash differences; others are rejected', () => {
  const f = {id: 'fx9', startsAt: NOW + 3600000}, cited = new Set(['https://club.example/news/team-news/?utm_source=openai']);
  const r = validateFixtureResult({id: 'fx9', availability: [{team: 'home', player: 'A', status: 'injured', source_url: 'https://www.club.example/news/team-news'}, {team: 'away', player: 'B', status: 'doubtful', source_url: 'https://club.example/other'}]}, f, cited, NOW);
  assert.deepEqual(r.availability.map(a => a.player), ['A']); assert.equal(r.rejected.length, 1);
});

test('empty availability rows are ignored and injury-report words map to the stored statuses', () => {
  const f = {id: 'fx8', startsAt: NOW + 3600000}, cited = new Set([SRC]);
  const r = validateFixtureResult({id: 'fx8', availability: [{team: 'home', player: '', status: '', source_url: ''}, {team: 'away', player: 'C', status: 'Out', source_url: SRC}, {team: 'away', player: 'D', status: 'questionable', source_url: SRC}, {team: 'home', player: 'E', status: 'resting', source_url: SRC}]}, f, cited, NOW);
  assert.deepEqual(r.availability.map(a => `${a.player}:${a.status}`), ['C:unavailable', 'D:doubtful']);
  assert.equal(r.rejected.length, 1); assert.match(r.rejected[0], /status "resting"/);
});
