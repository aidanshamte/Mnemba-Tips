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
// The cited page: names the teams, the suspended player and both starting XIs (verification reads the page itself).
const PAGE = `<html><head><meta property="article:published_time" content="${new Date(NOW - 3600000).toISOString()}"></head><body><h1>Team news</h1><p>Ben Okoro is suspended after a red card.</p><p>Confirmed line-ups: ${xi('H').map(p => p.name).join(', ')}; ${xi('A').map(p => p.name).join(', ')}</p><script>ignored()</script></body></html>`;
/** Network for a test: OpenAI calls go to `openai`; robots.txt is absent; any other URL serves `page`. */
const route = (openai, page = PAGE) => async (url, init) => String(url).includes('api.openai.com') ? openai(url, init) : String(url).endsWith('/robots.txt') ? new Response('', {status: 404}) : new Response(page, {headers: {'content-type': 'text/html'}});

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
  const w = await world(ENV, route(async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json(responseFor(JSON.parse(init.body).input.match(/id=([^ ]+)/g).map(x => x.slice(3)))); }));
  try {
    const fx = [1, 2, 3].map(i => normalizeFixture('api-football', apiFixture(7700 + i, 'NS', '2026-11-27T19:00:00Z', 10 + i, 20 + i)));
    const r = await researchBatch(w.service, fx);
    assert.equal(r.state, 'ok'); assert.equal(calls.length, 1, 'one request for three fixtures');
    assert.deepEqual(calls[0].tools, [{type: 'web_search', search_context_size: 'medium'}]); assert.equal(calls[0].text.format.type, 'json_schema'); assert.equal(calls[0].text.format.strict, true); assert.equal(r.record.schema, true); assert.equal(r.record.answer.parse, 'json'); assert.equal(r.record.diagnosis.enriched, 3); assert.equal(calls[0].max_tool_calls, 3); assert.equal(calls[0].store, false);
    assert.deepEqual(calls[0].include, ['web_search_call.action.sources'], 'search sources are requested so citations can be verified');
    assert.equal(r.record.searches, 2); assert.ok(r.record.actualUsd < r.record.estimatedUsd, 'reservation covered the actual cost');
    assert.ok(Math.abs(await spent(w.store) - r.record.actualUsd) < 1e-6, 'ledger holds the actual cost, not the reservation');
    assert.equal(r.results.every(x => x.availability[0]?.status === 'suspended'), true, JSON.stringify(r.results[0]));
  } finally { w.sqlite.close(); }
});

test('rolling stage: imminent lineups first, per-run and budget limits, research stored per fixture, no probability change', async () => {
  let n = 0;
  const w = await world({...ENV, OPENAI_MAX_REQUESTS_PER_RUN: '1'}, route(async (url, init) => { n++; const body = JSON.parse(init.body); const ids = body.input.match(/id=([^ ]+)/g).map(x => x.slice(3)); return Response.json(responseFor(ids, {lineup: body.input.includes('officially announced') ? {status: 'confirmed', source_url: SRC, published_at: new Date(NOW).toISOString(), home: {starters: xi('H')}, away: {starters: xi('A')}} : undefined})); }));
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

test('page verification: a claim the cited page does not state is rejected; per-team states separate not found from rejected', async () => {
  const {verifyAgainstSources} = await import('../../lib/football/openai-research.mjs'), {pageLoader} = await import('../../lib/football/source-verify.mjs');
  const f = {id: 'fx7', startsAt: NOW + 6 * 3600000, home: {name: 'Team 11'}, away: {name: 'Team 21'}}, cited = new Set([SRC]);
  const loader = pageLoader(route(async () => { throw Error('no OpenAI here'); }), {now: () => NOW});
  const v = validateFixtureResult({id: 'fx7', availability: [{team: 'away', player: 'Ben Okoro', status: 'suspended', source_url: SRC}, {team: 'away', player: 'Sam Invented', status: 'injured', source_url: SRC}]}, f, cited, NOW);
  const hosts = {}, r = await verifyAgainstSources(loader, v, f, hosts);
  assert.deepEqual(r.availability.map(a => a.player), ['Ben Okoro']); assert.equal(r.rejectedCounts.not_on_page, 1);
  assert.deepEqual(r.sides, {home: 'not_found', away: 'reported'}); assert.equal(r.outcome, 'enriched');
  assert.deepEqual(hosts['club.example'], {claims: 2, verified: 1, not_on_page: 1});
  const none = await verifyAgainstSources(loader, validateFixtureResult({id: 'fx7', teams: {home: {news: 'none_reported', source_url: SRC}}}, f, cited, NOW), f);
  assert.equal(none.sides.home, 'rejected', 'the page does not say "no absences", so it is not accepted as none reported');
  const blocked = pageLoader(async u => String(u).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /news', {status: 200}) : new Response(PAGE), {now: () => NOW});
  const b = await verifyAgainstSources(blocked, validateFixtureResult({id: 'fx7', availability: [{team: 'away', player: 'Ben Okoro', status: 'suspended', source_url: SRC}]}, f, cited, NOW), f);
  assert.equal(b.availability.length, 0); assert.equal(b.rejectedCounts.robots, 1);
});

test('contradictory statuses for one player are rejected; repeats are counted as duplicates', () => {
  const f = {id: 'fx6', startsAt: NOW + 3600000}, cited = new Set([SRC]);
  const r = validateFixtureResult({id: 'fx6', availability: [{team: 'home', player: 'A B', status: 'injured', source_url: SRC}, {team: 'home', player: 'A B', status: 'injured', source_url: SRC}, {team: 'home', player: 'C D', status: 'injured', source_url: SRC}, {team: 'home', player: 'C D', status: 'available_again', source_url: SRC}]}, f, cited, NOW);
  assert.deepEqual(r.availability.map(a => a.player), ['A B']); assert.equal(r.duplicates, 1); assert.ok(r.rejectedCounts.contradictory >= 1);
});

test('priority: major competitions and imminent lineups first, small leagues keep a non-zero chance after a failure', async () => {
  const P = await import('../../lib/football/research-priority.mjs');
  const mk = (name, country, h) => ({id: name + h, sport: 'football', startsAt: NOW + h * 3600000, competition: {id: name, name, country: {name: country}}, home: {id: 'h' + name}, away: {id: 'a' + name}});
  const ctx = {now: NOW, hasForecast: true, totalRequests: 10};
  const epl = P.fixtureScore(mk('Premier League', 'England', 20), 'availability', ctx), small = P.fixtureScore(mk('Division 2', 'Ruritania', 20), 'availability', ctx);
  assert.ok(epl > 2 * small, 'a major league is worth more');
  const failed = P.fixtureScore(mk('Division 2', 'Ruritania', 20), 'availability', {...ctx, comp: {availability: {requests: 3, fixtures: 12, enriched: 0, lastAt: NOW - 864e5}}});
  assert.ok(failed > 0 && failed < small, 'repeated failures lower but never remove a league');
  assert.equal(P.fixtureScore(mk('Premier League', 'England', 1), 'lineups', {...ctx, providerLineup: true}), 0, 'no paid lineup search when a provider already has the team sheet');
  assert.equal(P.fixtureScore(mk('Premier League', 'England', 20), 'availability', {...ctx, record: {verifiedAt: NOW - 3600000}}), 0, 'fresh research is not repeated');
  const plan = P.planBatches([mk('Liga A', 'X', 20), mk('Liga B', 'X', 21), mk('Liga C', 'Y', 22)].map(f => ({f, score: 0.2})), 5);
  assert.equal(plan[0].batch.length, 2, 'small competitions of one country share a request (shared national sources)');
});

test('an unparsed paid answer is recorded for diagnosis and counted as a failed attempt so the planner learns', async () => {
  const prose = {id: 'resp_x', status: 'completed', output: [{type: 'web_search_call', action: {type: 'search', sources: []}}, {type: 'message', content: [{type: 'output_text', text: 'I could not find team news for these games.'}]}], usage: {input_tokens: 8000, output_tokens: 600}};
  const w = await world({...ENV, OPENAI_MAX_REQUESTS_PER_RUN: '1'}, route(async () => Response.json(prose)));
  try {
    await w.service.saveFixtures([2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(7900 + i, 'NS', '2026-11-28T15:00:00Z', 60 + i, 70 + i))));
    const r = await researchUpcoming(w.service);
    assert.equal(r.requests, 1); assert.equal(r.unparsed, 1); assert.ok(r.usd > 0, 'the paid request is still counted');
    const req = (await w.store.all("SELECT payload FROM football_cache WHERE id LIKE 'openai:req:%'")).map(x => JSON.parse(x.payload).data ?? JSON.parse(x.payload))[0];
    assert.match(req.unparsed.text, /could not find/); assert.equal(req.unparsed.status, 'completed');
    const stats = (await w.store.cache('openai:batch-stats')).data, total = Object.values(stats).reduce((n, x) => n + x.requests, 0);
    assert.equal(total, 1); assert.equal(Object.values(stats)[0].unparsed, 1); assert.equal(Object.values(stats)[0].enriched, 0);
    const comp = Object.values((await w.store.cache('openai:competition-stats')).data)[0];
    assert.equal(comp.availability.requests, 1); assert.equal(comp.availability.outcome_unparsed, 3); assert.equal(comp.availability.enriched ?? 0, 0);
  } finally { w.sqlite.close(); }
});

test('response contract: schema rejection falls back once unbilled; refusals and truncated answers are recorded and recovered', async () => {
  const {readAnswer, salvageFixtures, diagnose, RESEARCH_SCHEMA} = await import('../../lib/football/openai-research.mjs');
  // Strict schema rules: every object closes additional properties and requires all of its keys.
  const walk = n => { if (n?.type === 'object') { assert.equal(n.additionalProperties, false); assert.deepEqual(n.required, Object.keys(n.properties)); Object.values(n.properties).forEach(walk); } if (n?.items) walk(n.items); };
  walk(RESEARCH_SCHEMA);
  const calls = [];
  const w = await world(ENV, route(async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.text) return Response.json({error: {message: "Invalid parameter: 'text.format' of type 'json_schema' is not supported with this tool."}}, {status: 400});
    return Response.json(responseFor(body.input.match(/id=([^ ]+)/g).map(x => x.slice(3))));
  }));
  try {
    const fx = [normalizeFixture('api-football', apiFixture(7711, 'NS', '2026-11-27T19:00:00Z', 11, 21))];
    const r = await researchBatch(w.service, fx);
    assert.equal(calls.length, 2, 'one rejected (unprocessed) request, then one prompt-contract request'); assert.ok(!calls[1].text);
    assert.equal(r.state, 'ok'); assert.equal(r.record.schema, false);
    assert.ok(Math.abs(await spent(w.store) - r.record.actualUsd) < 1e-6, 'the rejected request cost nothing');
    assert.ok((await w.store.cache('openai:schema-unsupported')).data.message);
    await researchBatch(w.service, fx); assert.equal(calls.length, 3, 'the rejection is remembered: no schema attempt next time');
  } finally { w.sqlite.close(); }
  // Refusal, empty, prose, truncated JSON (sanitized from production shapes).
  const msg = content => ({status: 'completed', output: [{type: 'message', content}]});
  assert.equal(readAnswer(msg([{type: 'refusal', refusal: 'I cannot help with that.'}])).refusal, 'I cannot help with that.');
  assert.equal(readAnswer(msg([])).parse, 'empty');
  assert.equal(readAnswer(msg([{type: 'output_text', text: 'I could not find any injury news for these games.'}])).parse, 'malformed');
  const truncated = '{"fixtures":[{"id":"a","teams":{"home":{"news":"reported","source_url":"x"}},"availability":[{"team":"home","player":"P \\"Q\\" R","status":"injured"}]},{"id":"b","availability":[{"team":"aw';
  assert.deepEqual(salvageFixtures(truncated).map(x => x.id), ['a'], 'complete objects recovered; the cut-off one is dropped, never completed');
  assert.equal(readAnswer(msg([{type: 'output_text', text: truncated}])).parse, 'salvaged');
  assert.equal(readAnswer(msg([{type: 'output_text', text: '```json\n{"fixtures":[{"id":"a"}]}\n```'}])).parse, 'extracted');
  // Diagnosis names the reason a paid request produced nothing usable.
  const nf = {sides: {home: 'not_found', away: 'not_found'}, outcome: 'not_found', rejectedCounts: {}};
  assert.match(diagnose([nf, nf], {missingIds: 0}).reason, /no team news/);
  assert.match(diagnose([{...nf, rejectedCounts: {uncited: 2}}], {missingIds: 0}).reason, /uncited 2/);
  assert.match(diagnose([nf], {missingIds: 1}).reason, /fixture ids/);
});

test('low-yield backoff: after six barren paid requests, at most one exploratory request per six hours', async () => {
  let n = 0;
  const w = await world({...ENV, OPENAI_MAX_REQUESTS_PER_RUN: '1'}, route(async (url, init) => { n++; const ids = JSON.parse(init.body).input.match(/id=([^ ]+)/g).map(x => x.slice(3)); return Response.json(responseFor(ids)); }));
  try {
    await w.service.saveFixtures([2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(7900 + i, 'NS', '2026-11-28T15:00:00Z', 60 + i, 70 + i))));
    // Production shape: six hourly requests, every team not_found.
    for (let i = 0; i < 6; i++) await w.store.putCache(`openai:req:${NOW - (6 - i) * 3600000}:x${i}`, {at: NOW - (6 - i) * 3600000, diagnosis: {fixtures: 5, enriched: 0, teamsReported: 0, teamsNoneReported: 0, teamsNotFound: 10}}, 864e5);
    const r = await researchUpcoming(w.service);
    assert.equal(n, 0, 'no paid request while the approach is not producing anything'); assert.equal(r.stopped, 'low-yield backoff'); assert.equal(r.backoffUntil, NOW - 3600000 + 6 * 3600000);
    w.advance(5 * 3600000 + 60000);
    const r2 = await researchUpcoming(w.service);
    assert.equal(n, 1, 'one exploratory request once the backoff has elapsed'); assert.equal(r2.requests, 1);
    // That request found news, so the next run is not held back.
    w.advance(3600000); const r3 = await researchUpcoming(w.service); assert.notEqual(r3.stopped, 'low-yield backoff');
  } finally { w.sqlite.close(); }
});
