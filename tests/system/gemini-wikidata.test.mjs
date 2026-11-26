// GeminiSportsIntelligence (ungrounded, evidence-bound) and Wikidata identity matching for logos.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {geminiState, validateExplanation, factPack, generateExplanation, explainUpcoming} from '../../lib/football/gemini-intelligence.mjs';
import {chooseCandidate, normName, wikidataMatch} from '../../lib/football/wikidata-match.mjs';
import {intelligenceStatus} from '../../lib/football/intelligence-status.mjs';

const ENV = {GEMINI_ENABLED: 'true', GEMINI_API_KEY: 'test-key-not-real', GEMINI_MODEL: 'gemini-test-flash', GEMINI_PAID_USAGE_ALLOWED: 'false', GEMINI_DAILY_REQUEST_LIMIT: '3'};
const F = {home: {name: 'Borneo FC'}, away: {name: 'Persita Tangerang'}, competition: {name: 'Indonesia Liga 1'}};
const FORECAST = {probabilities: [0.32, 0.25, 0.43], expectedGoals: [1.21, 1.53], factors: {homeForm: {games: 10, wins: 3, draws: 3, losses: 4}, awayForm: {games: 10, wins: 5, draws: 2, losses: 3}, home: {scored: 1.2, conceded: 1.6}, away: {scored: 1.5, conceded: 1.1}, headToHead: {games: 4, homeWins: 1, awayWins: 2}}};

test('Gemini is off unless explicitly enabled with a key, a named model and paid usage disallowed', () => {
  assert.equal(geminiState({}).enabled, false);
  assert.match(geminiState({...ENV, GEMINI_API_KEY: ''}).reason, /API_KEY/);
  assert.match(geminiState({...ENV, GEMINI_MODEL: ''}).reason, /GEMINI_MODEL/);
  assert.match(geminiState({...ENV, GEMINI_PAID_USAGE_ALLOWED: 'true'}).reason, /Paid usage/);
  assert.equal(geminiState(ENV).enabled, true);
});

test('explanations may only use supplied facts: invented numbers, unknown facts and certainty are rejected', () => {
  const facts = factPack(F, FORECAST);
  assert.ok(facts.find(f => f.id === 'p_away').value === 43);
  const ok = {points: [{text: 'Persita Tangerang are rated slight favourites at 43 percent, helped by 5 wins in recent form.', facts: ['p_away', 'away_wins']}], caveat: 'This is an estimate and can be wrong.'};
  assert.equal(validateExplanation(JSON.stringify(ok), facts).points.length, 1);
  assert.match(validateExplanation({points: [{text: 'Borneo FC have scored 27 goals at home this season.', facts: ['home_scored']}]}, facts).error, /Number 27/);
  assert.match(validateExplanation({points: [{text: 'The striker is injured and will miss the match.', facts: ['injury']}]}, facts).error, /unknown/);
  assert.match(validateExplanation({points: [{text: 'Persita Tangerang are a guaranteed winner here.', facts: ['p_away']}]}, facts).error, /certainty/);
  assert.match(validateExplanation('not json', facts).error, /JSON/);
  assert.equal(validateExplanation({points: [{text: 'Persita Tangerang lead the estimate at 43 percent.', facts: ['p_away']}], caveat: 'They won 9 of 10.'}, facts).caveat, null, 'caveat with numbers dropped');
});

async function world(env, fetcher) {
  const db = database(); db.store.now = () => Date.parse('2026-11-26T12:00:00Z'); await db.store.init();
  const service = new IntelligenceService(db.store, env, {fetcher, sleep: async () => {}}); await service.initialize(); return {...db, service};
}

test('generation sends no search tool, sends the key only as a header, validates, and respects the daily budget', async () => {
  const seen = [];
  const reply = {points: [{text: 'Persita Tangerang lead the estimate at 43 percent.', facts: ['p_away']}], caveat: 'Estimates can be wrong.'};
  const fetcher = async (url, init) => { seen.push({url: String(url), init}); return Response.json({candidates: [{content: {parts: [{text: JSON.stringify(reply)}]}}], usageMetadata: {promptTokenCount: 300, candidatesTokenCount: 60}}); };
  const w = await world(ENV, fetcher);
  try {
    const r = await generateExplanation(w.service, F, FORECAST);
    assert.equal(r.state, 'ok');
    const body = JSON.parse(seen[0].init.body);
    assert.equal(body.tools, undefined, 'no Google Search grounding'); assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.doesNotMatch(seen[0].url, /test-key-not-real/, 'key never in the URL');
    assert.equal(new Headers(seen[0].init.headers).get('x-goog-api-key'), 'test-key-not-real');
    assert.equal(Number((await w.store.one("SELECT COUNT(*) n FROM http_response_cache WHERE source_id='gemini'")).n), 0, 'responses not stored in the HTTP cache');
    await generateExplanation(w.service, F, FORECAST); await generateExplanation(w.service, F, FORECAST);
    await assert.rejects(generateExplanation(w.service, F, FORECAST), /budget exhausted/, 'local daily limit of 3 enforced');
    assert.equal(seen.length, 3);
  } finally { w.sqlite.close(); }
});

test('disabled module makes no request; scheduled explanations are stored per forecast and not regenerated', async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json({candidates: [{content: {parts: [{text: JSON.stringify({points: [{text: 'The away side lead the estimate at 43 percent.', facts: ['p_away']}]})}]}}]}); };
  const off = await world({}, fetcher);
  try { assert.equal((await explainUpcoming(off.service)).state, 'disabled'); assert.equal(calls, 0); } finally { off.sqlite.close(); }
  const w = await world({...ENV, GEMINI_DAILY_REQUEST_LIMIT: '10'}, fetcher);
  try {
    const f = normalizeFixture('api-football', apiFixture(9901, 'NS', '2026-11-26T18:00:00Z', 10, 20)); await w.service.saveFixtures([f]);
    await w.store.run('INSERT INTO analysis_forecasts(id,fixture_id,model_version,as_of,kickoff_at,max_known_at,training_allowed,payload,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)', 'af1', f.id, 'poisson-temporal-1', Date.parse('2026-11-26T10:00:00Z'), f.startsAt, Date.parse('2026-11-26T09:00:00Z'), 1, JSON.stringify(FORECAST), '[]');
    const r1 = await explainUpcoming(w.service); assert.equal(r1.ok, 1);
    assert.equal((await w.store.cache(`ai-explain:${f.id}`)).data.forecastId, 'af1');
    const r2 = await explainUpcoming(w.service); assert.equal(r2.processed, 0, 'same forecast not regenerated'); assert.equal(calls, 1);
    const status = await intelligenceStatus(w.service);
    assert.equal(status.gemini.requestsToday, 1); assert.equal(status.gemini.explanationsStored, 1);
    assert.doesNotMatch(JSON.stringify(status), /test-key-not-real/, 'status never exposes the key');
  } finally { w.sqlite.close(); }
});

// Wikidata candidates (shapes as returned by wbgetentities).
const item = (id, label, types, countries, aliases = []) => ({id, labels: {en: {value: label}}, aliases: {en: aliases.map(value => ({value}))}, claims: {P31: types.map(t => ({rank: 'normal', mainsnak: {datavalue: {value: {id: t}}}})), P17: countries.map(c => ({rank: 'normal', mainsnak: {datavalue: {value: {id: c}}}}))}});
const COUNTRIES = new Map([['Q252', {code: 'ID', labels: ['Indonesia']}], ['Q1033', {code: 'NG', labels: ['Nigeria']}], ['Q851', {code: 'SA', labels: ['Saudi Arabia']}]]);

test('Wikidata matching needs type, country and exact name, and refuses ambiguity and women/youth mismatches', () => {
  const borneo = item('Q1', 'Borneo F.C.', ['Q476028'], ['Q252']);
  assert.deepEqual(chooseCandidate({name: 'Borneo FC', country: 'Indonesia', countryCode: 'ID'}, 'team', [borneo], COUNTRIES), {qid: 'Q1'});
  assert.ok(chooseCandidate({name: 'Borneo FC', country: 'Nigeria', countryCode: 'NG'}, 'team', [borneo], COUNTRIES).reason, 'same name, other country: no match');
  const women = item('Q2', 'Borneo FC Women', ['Q51481377'], ['Q252']);
  assert.ok(chooseCandidate({name: 'Borneo FC', country: 'Indonesia', countryCode: 'ID'}, 'team', [women], COUNTRIES).reason, "men's team never matched to a women's club");
  const twin = item('Q3', 'Borneo FC', ['Q476028'], ['Q252']);
  assert.match(chooseCandidate({name: 'Borneo FC', country: 'Indonesia', countryCode: 'ID'}, 'team', [borneo, twin], COUNTRIES).reason, /ambiguous/);
  const league = item('Q4', 'Liga 1', ['Q15991303'], ['Q252'], ['Indonesia Liga 1']);
  assert.deepEqual(chooseCandidate({name: 'Indonesia Liga 1', country: 'Indonesia', countryCode: 'ID'}, 'competition', [league], COUNTRIES), {qid: 'Q4'});
  assert.ok(chooseCandidate({name: 'Al Hilal', country: 'Saudi Arabia', countryCode: 'SA'}, 'team', [item('Q5', 'Al-Hilal SFC', ['Q476028'], ['Q851'])], COUNTRIES).qid, 'punctuation-insensitive exact name');
  assert.equal(normName('Al-Hilal S.F.C.'), normName('Al Hilal SFC'));
});

test('end to end: a verified link is added to the canonical identity and the media stage is re-queued; conflicts are recorded', async () => {
  const entities = {Q1: item('Q1', 'Borneo F.C.', ['Q476028'], ['Q252']), Q252: {id: 'Q252', labels: {en: {value: 'Indonesia'}}, claims: {P297: [{mainsnak: {datavalue: {value: 'ID'}}}]}}};
  let requests = 0;
  const fetcher = async url => { requests++; const u = new URL(url); if (u.searchParams.get('action') === 'wbsearchentities') return Response.json({search: [{id: 'Q1'}]}); return Response.json({entities: Object.fromEntries(u.searchParams.get('ids').split('|').map(id => [id, entities[id]]))}); };
  const w = await world({}, fetcher);
  try {
    const s = w.store;
    await s.run("INSERT INTO competitions(id,provider,external_id,name,payload,updated_at) VALUES('comp:id1','fivedollar','1','Indonesia Liga 1',?,0)", JSON.stringify({id: 'comp:id1', name: 'Indonesia Liga 1', country: {name: 'Indonesia', code: 'ID'}})).catch(async () => {});
    const f = normalizeFixture('api-football', apiFixture(9950, 'NS', '2026-11-27T08:00:00Z', 10, 20));
    await w.service.saveFixtures([{...f, home: {...f.home, name: 'Borneo FC'}}]);
    await s.run('UPDATE fixtures SET competition_id=? WHERE id=?', 'comp:id1', f.id);
    const comp = await s.one("SELECT id FROM competitions WHERE id='comp:id1'"); if (!comp) await s.upsert('competitions', {id: 'comp:id1', provider: 'fivedollar', external_id: '1', name: 'Indonesia Liga 1', payload: JSON.stringify({id: 'comp:id1', name: 'Indonesia Liga 1', country: {name: 'Indonesia', code: 'ID'}}), updated_at: 0});
    await s.upsert('canonical_entities', {id: 'team:borneo', kind: 'team', name: 'Borneo FC', payload: '{}', updated_at: 0});
    await s.run("INSERT INTO entity_aliases(id,canonical_id,provider,provider_id,alias,normalized_alias,verified) VALUES(?,?,?,?,?,?,1) ON CONFLICT(provider,provider_id) DO UPDATE SET canonical_id=excluded.canonical_id,verified=1", f.home.id, 'team:borneo', 'api-football', f.home.id, 'Borneo FC', 'borneo fc');
    await s.run("INSERT INTO media_enrichment(entity_id,entity_type,state,next_attempt,attempts,payload) VALUES(?,'team','skipped',?,1,?) ON CONFLICT(entity_id) DO UPDATE SET state='skipped',payload=excluded.payload", f.home.id, Date.parse('2026-12-20'), JSON.stringify({reason: 'No verified media identity or permitted source'}));
    const r = await wikidataMatch(w.service, {limit: 5});
    assert.equal(r.linked, 1, JSON.stringify(r));
    assert.equal((await s.one("SELECT canonical_id FROM entity_aliases WHERE provider_id='wikidata:Q1'")).canonical_id, 'team:borneo');
    assert.equal((await s.one("SELECT wikidata_id FROM canonical_entities WHERE id='team:borneo'")).wikidata_id, 'Q1');
    assert.equal((await s.one('SELECT state FROM media_enrichment WHERE entity_id=?', f.home.id)).state, 'pending', 'media stage retries with the new identity');
    const again = await wikidataMatch(w.service, {limit: 5}); assert.equal(again.checked, 0, 'resolved entities are not searched again');
    assert.ok(requests <= 3);
  } finally { w.sqlite.close(); }
});
