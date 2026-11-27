// OpenAI pre-match research (Responses API + web_search) for fixtures in the next 48 hours, under a hard $5 budget.
// - Facts only with a cited source; a lineup is CONFIRMED only with exactly 11 distinct starters and a cited source
//   published for this match; otherwise it is PREDICTED (with a source) or dropped.
// - Display rule (OpenAI web search guide): information from web results is shown with inline, clickable citations.
// - Budget: a concurrency-safe ledger (micro-USD) reserves the worst case before each request and reconciles with the
//   reported usage and the number of billed search actions afterwards. Requests stop before the cap.
// - Context only: research never changes probabilities (no adjustment has passed out-of-sample evaluation yet).
import {recordShadowSnapshot} from './shadow-model.mjs';
import {pageLoader, checkClaim} from './source-verify.mjs';
import {fixtureScore, planBatches, competitionKey} from './research-priority.mjs';
const ENDPOINT = 'https://api.openai.com/v1/responses';
export const PRICES = {'gpt-4o-mini': {input: 0.15, output: 0.60, searchBlock: 8000}, 'gpt-4.1-mini': {input: 0.40, output: 1.60, searchBlock: 8000}};
const SEARCH_USD = 0.010, HARD_CAP_USD = 5;
const MICRO = 1e6;

export function openaiState(env = {}) {
  if (String(env.OPENAI_ENABLED ?? '').toLowerCase() !== 'true') return {enabled: false, reason: 'OPENAI_ENABLED is not true'};
  if (!env.OPENAI_API_KEY) return {enabled: false, reason: 'OPENAI_API_KEY is not configured'};
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!PRICES[model]) return {enabled: false, reason: `OPENAI_MODEL ${model} has no recorded price; add it to PRICES first`};
  const budget = Math.min(HARD_CAP_USD, Number(env.OPENAI_BUDGET_USD) || HARD_CAP_USD);
  return {enabled: true, model, budget, maxSearches: Math.max(1, Math.min(4, Number(env.OPENAI_MAX_SEARCHES_PER_REQUEST) || 3)), maxOutput: Math.max(600, Math.min(4000, Number(env.OPENAI_MAX_OUTPUT_TOKENS) || 2500)),
    // gpt-4o-mini search content is billed as a fixed block per call, so a richer context costs no more per search.
    searchContext: ['low', 'medium', 'high'].includes(env.OPENAI_SEARCH_CONTEXT) ? env.OPENAI_SEARCH_CONTEXT : 'medium'};
}

/** Worst-case cost of one request (USD). */
export function worstCase(st, promptTokens, maxOutput = st.maxOutput) {
  const p = PRICES[st.model];
  return st.maxSearches * (SEARCH_USD + p.searchBlock * p.input / MICRO) + (promptTokens + 1500) * p.input / MICRO + maxOutput * p.output / MICRO;
}
/** Output budget grows with the batch (about 350 tokens per fixture), bounded. */
export const outputBudget = (st, n) => Math.min(8000, Math.max(st.maxOutput, 500 + 350 * n));
/** Actual cost from reported usage and billed search actions (USD). */
export function actualCost(model, usage, searches) {
  const p = PRICES[model];
  return searches * SEARCH_USD + (usage?.input_tokens ?? 0) * p.input / MICRO + (usage?.output_tokens ?? 0) * p.output / MICRO;
}

const LEDGER = ['openai', 'spend-total-usd-micro'];   // registered source id (foreign key) with a non-date key
export async function spent(store) { return Number((await store.one('SELECT used FROM source_request_usage WHERE source_id=? AND day=?', ...LEDGER))?.used ?? 0) / MICRO; }
/** Atomically reserve micro-USD; false when the reservation would pass the cap. */
export async function reserve(store, usd, capUsd) {
  const amount = Math.ceil(usd * MICRO), cap = Math.floor(capUsd * MICRO);
  if (amount > cap) return false;
  const row = await store.one('INSERT INTO source_request_usage(source_id,day,used) VALUES(?,?,?) ON CONFLICT(source_id,day) DO UPDATE SET used=source_request_usage.used+? WHERE source_request_usage.used+?<=? RETURNING used', ...LEDGER, amount, amount, amount, cap);
  return Boolean(row);
}
export async function settle(store, reservedUsd, actualUsd) {
  await store.run('UPDATE source_request_usage SET used=used+? WHERE source_id=? AND day=?', Math.ceil(actualUsd * MICRO) - Math.ceil(reservedUsd * MICRO), ...LEDGER);
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isUrl = u => { try { return ['https:', 'http:'].includes(new URL(u).protocol); } catch { return false; } };
/** Comparable form of a URL: https, host without www, no fragment, no utm_* parameters, no trailing slash. */
export function normUrl(u) {
  try { const x = new URL(u); x.protocol = 'https:'; x.hash = ''; x.hostname = x.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...x.searchParams.keys()]) if (/^utm_/i.test(k)) x.searchParams.delete(k);
    return x.href.replace(/\/(?=$|\?)/, ''); } catch { return null; }
}

const STATUS_MAP = {out: 'unavailable', questionable: 'doubtful', 'game-time decision': 'doubtful', 'game time decision': 'doubtful', suspension: 'suspended', injury: 'injured', 'day-to-day': 'doubtful'};
const SIDE_RANK = {reported: 3, none_reported: 2, rejected: 1, not_found: 0};

/**
 * Structural validation of one fixture result: vocabulary, team, the source must be one this response's web search
 * returned or cited, contradictions and duplicates. Page-level checks (does the source state the claim?) follow in
 * verifyAgainstSources. Rejections are counted by reason.
 */
export function validateFixtureResult(r, fixture, cited, now) {
  const out = {fixtureId: fixture.id, lineup: {status: 'not_announced'}, availability: [], circumstances: [], none: [], rejected: [], rejectedCounts: {}, duplicates: 0, claimed: {home: false, away: false}};
  const reject = (reason, text) => { out.rejectedCounts[reason] = (out.rejectedCounts[reason] ?? 0) + 1; out.rejected.push(text); };
  const citedN = new Set([...cited].map(normUrl).filter(Boolean));
  const ok = url => isUrl(url) && citedN.has(normUrl(url));
  const published = t => { const ms = Date.parse(t); return Number.isFinite(ms) && ms <= now + 3600000 ? ms : null; };
  const lu = r?.lineup;
  if (lu && ['confirmed', 'predicted'].includes(lu.status)) {
    const side = t => (Array.isArray(t?.starters) ? t.starters : []).map(p => ({name: String(p?.name ?? '').trim(), number: Number.isInteger(p?.number) ? p.number : null, position: typeof p?.position === 'string' ? p.position : null})).filter(p => p.name);
    const home = side(lu.home), away = side(lu.away), distinct = a => new Set(a.map(p => norm(p.name))).size;
    let status = lu.status;
    const src = ok(lu.source_url) ? lu.source_url : null, at = published(lu.published_at);
    const need = fixture.sport === 'basketball' ? 5 : 11;
    if (status === 'confirmed') {
      const valid = home.length === need && away.length === need && distinct(home) === need && distinct(away) === need && src && at && at >= fixture.startsAt - 6 * 3600000;
      if (!valid) { reject('lineup_checks', `confirmed lineup failed checks (${need} distinct starters per team, cited source, published within 6 h of the start)`); status = src && home.length >= need - 1 && away.length >= need - 1 ? 'predicted' : null; }
    } else if (!src) { reject('uncited', 'predicted lineup without a source from this search'); status = null; }
    if (status) out.lineup = {status, source: src, publishedAt: at, home: {formation: typeof lu.home?.formation === 'string' ? lu.home.formation : null, starters: home}, away: {formation: typeof lu.away?.formation === 'string' ? lu.away.formation : null, starters: away}};
  } else if (lu?.status === 'not_announced') out.lineup = {status: 'not_announced'};
  const seen = new Map();
  for (const a of Array.isArray(r?.availability) ? r.availability : []) {
    if (!String(a?.player ?? '').trim()) continue;                         // empty template row: no news, not a claim
    const raw = String(a?.status ?? '').toLowerCase().trim(), st = STATUS_MAP[raw] ?? raw;
    if (!['injured', 'suspended', 'doubtful', 'unavailable', 'available_again'].includes(st) || !['home', 'away'].includes(a?.team)) { reject('malformed', `availability item malformed (status "${raw.slice(0, 24)}", team "${String(a?.team ?? '').slice(0, 8)}")`); continue; }
    out.claimed[a.team] = true;
    if (!ok(a.source_url)) { reject('uncited', `availability for ${a.player} has no source from this search`); continue; }
    const key = `${a.team}|${norm(a.player)}`, item = {team: a.team, player: String(a.player).trim(), status: st, position: typeof a.position === 'string' ? a.position.slice(0, 24) : null, detail: typeof a.detail === 'string' ? a.detail.slice(0, 200) : null, source: a.source_url, publishedAt: published(a.published_at)};
    const prev = seen.get(key);
    if (prev && prev.status === st) { out.duplicates++; continue; }
    if (prev) { prev.contradicted = true; reject('contradictory', `${a.player}: contradictory statuses (${prev.status} / ${st})`); continue; }
    seen.set(key, item);
  }
  out.availability = [...seen.values()].filter(a => { if (a.contradicted) { reject('contradictory', `${a.player}: dropped (contradictory)`); return false; } return true; });
  for (const side of ['home', 'away']) {
    const t = r?.teams?.[side];
    if (t?.news === 'none_reported') { out.claimed[side] = true; if (ok(t.source_url)) out.none.push({team: side, source: t.source_url}); else reject('uncited', `${side}: "no absences" without a source from this search`); }
  }
  for (const c of Array.isArray(r?.circumstances) ? r.circumstances : []) {
    if (!['rotation', 'manager', 'congestion', 'rest', 'weather', 'tactical', 'other'].includes(c?.type) || typeof c?.detail !== 'string' || !c.detail.trim()) continue;
    if (!ok(c.source_url)) { reject('uncited', 'circumstance without a source from this search'); continue; }
    out.circumstances.push({type: c.type, team: ['home', 'away'].includes(c.team) ? c.team : null, detail: c.detail.slice(0, 240), source: c.source_url, publishedAt: published(c.published_at)});
  }
  return out;
}

/**
 * Page-level verification: each kept claim must be stated by the page it cites (player + team + status near the
 * name; the page must concern this match or be recent; not older than 10 days). Sets per-side states
 * (reported | none_reported | rejected | not_found) and the fixture outcome (enriched | rejected | not_found).
 */
export async function verifyAgainstSources(loader, v, fixture, hostStats = {}) {
  const team = side => fixture[side]?.name, other = side => fixture[side === 'home' ? 'away' : 'home']?.name, base = {startsAt: fixture.startsAt};
  const reject = (reason, text) => { v.rejectedCounts[reason] = (v.rejectedCounts[reason] ?? 0) + 1; v.rejected.push(text); };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'invalid'; } };
  const tally = (u, verdict) => { const h = host(u), x = hostStats[h] ?? {claims: 0, verified: 0}; x.claims++; if (verdict === 'verified') x.verified++; else x[verdict] = (x[verdict] ?? 0) + 1; hostStats[h] = x; };
  const check = async (url, claim) => { const res = checkClaim(await loader.load(url), {...base, ...claim}); tally(url, res.verdict); return res; };
  const kept = [];
  for (const a of v.availability) {
    const res = await check(a.source, {kind: 'availability', player: a.player, status: a.status, team: team(a.team), opponent: other(a.team)});
    if (res.verdict === 'verified') kept.push({...a, publishedAt: a.publishedAt ?? res.publishedAt ?? null, verified: true}); else reject(res.verdict, `${a.player}: ${res.reason ?? res.verdict}`);
  }
  v.availability = kept;
  if (['confirmed', 'predicted'].includes(v.lineup.status)) {
    const h = await check(v.lineup.source, {kind: 'lineup', starters: v.lineup.home.starters, team: team('home'), opponent: other('home')});
    const a = h.verdict === 'verified' ? await check(v.lineup.source, {kind: 'lineup', starters: v.lineup.away.starters, team: team('away'), opponent: other('away')}) : h;
    if (a.verdict !== 'verified') { reject(a.verdict, `lineup: ${a.reason ?? a.verdict}`); v.lineup = {status: 'not_announced', rejected: true}; }
  }
  const noneOk = [];
  for (const n of v.none) { const res = await check(n.source, {kind: 'none', team: team(n.team), opponent: other(n.team)}); if (res.verdict === 'verified') noneOk.push(n); else reject(res.verdict, `${n.team} "no absences": ${res.reason ?? res.verdict}`); }
  v.none = noneOk;
  const circ = [];
  for (const c of v.circumstances) { const side = c.team ?? 'home', res = await check(c.source, {kind: 'context', team: team(side), opponent: other(side)}); if (res.verdict === 'verified') circ.push(c); else reject(res.verdict, `circumstance: ${res.reason ?? res.verdict}`); }
  v.circumstances = circ;
  v.sides = Object.fromEntries(['home', 'away'].map(side => [side, v.availability.some(a => a.team === side) ? 'reported' : v.none.some(n => n.team === side) ? 'none_reported' : v.claimed[side] ? 'rejected' : 'not_found']));
  const useful = v.availability.length || ['confirmed', 'predicted'].includes(v.lineup.status) || v.none.length || v.circumstances.length;
  v.outcome = useful ? 'enriched' : Object.keys(v.rejectedCounts).length ? 'rejected' : 'not_found';
  delete v.claimed;
  return v;
}

/** Merge a new verified result with the stored record (delta updates): confirmed beats predicted; newest availability wins. */
export function mergeResearch(prev, next, now) {
  if (!prev) return {...next, verifiedAt: now};
  const lineup = next.lineup.status === 'confirmed' || (next.lineup.status === 'predicted' && prev.lineup?.status !== 'confirmed') ? next.lineup : prev.lineup;
  const key = a => `${a.team}|${norm(a.player)}`, avail = new Map((prev.availability ?? []).map(a => [key(a), a]));
  for (const a of next.availability) { const old = avail.get(key(a)); if (!old || (a.publishedAt ?? 0) >= (old.publishedAt ?? 0)) avail.set(key(a), a); }
  const circ = [...(prev.circumstances ?? []), ...next.circumstances].filter((c, i, all) => all.findIndex(x => x.source === c.source && x.detail === c.detail) === i).slice(-12);
  const sides = Object.fromEntries(['home', 'away'].map(side => { const a = prev.sides?.[side] ?? ((prev.availability ?? []).some(x => x.team === side) ? 'reported' : 'not_found'), b = next.sides?.[side] ?? 'not_found'; return [side, (SIDE_RANK[b] ?? 0) >= (SIDE_RANK[a] ?? 0) ? b : a]; }));
  const outcome = next.outcome === 'enriched' || prev.outcome === 'enriched' || (prev.availability ?? []).length ? 'enriched' : next.outcome;
  return {...prev, lineup, availability: [...avail.values()], none: next.none?.length ? next.none : prev.none ?? [], circumstances: circ, sides, outcome, rejected: next.rejected, rejectedCounts: next.rejectedCounts, verifiedAt: now};
}

function buildPrompt(batch, known, mode) {
  const sport = batch[0]?.sport === 'basketball' ? 'basketball' : 'football', starters = sport === 'basketball' ? 'starting five' : 'starting XI';
  const comps = [...new Set(batch.map(f => f.competition?.name).filter(Boolean))];
  const lines = batch.map(f => `- id=${f.id} | ${f.home.name} (home) v ${f.away.name} (away) | ${f.competition?.name ?? ''}${f.competition?.country?.name ? ' (' + f.competition.country.name + ')' : ''} | kickoff ${new Date(f.startsAt).toISOString()}`);
  const prior = known.length ? ['Already verified (do NOT search for these again; report only changes):', ...known.map(k => `- id=${k.id}: lineup ${k.status}${k.players ? '; availability known for ' + k.players : ''}`)] : [];
  return [
    `Research these ${sport} ${sport === 'basketball' ? 'games' : 'fixtures'} using web search. Focus: ${mode === 'lineups' ? `officially announced ${starters}` : sport === 'basketball' ? 'official injury reports (out, doubtful/questionable), rest decisions, expected starting five, rotation changes' : 'injuries, suspensions, doubtful players, expected lineups, rotation, managerial changes, fixture congestion'}.`,
    `Search efficiently: prefer ONE competition-wide page (e.g. a ${comps.slice(0, 2).join(' / ') || 'league'} injury or team-news round-up, or an official injury report) that covers several of these matches, then fill gaps.`,
    'Rules: report only facts stated on a page you found in this search, with that exact page URL and its publication time (ISO 8601). Never guess. The page itself must name the player, the team and the status.',
    'For each team say whether you found news: "reported" (absences listed), "none_reported" (a page explicitly says no absences; give its URL) or "not_found" (nothing found). Not finding news is NOT the same as no absences.',
    'Return exactly one entry for EVERY fixture id listed below, in the same order, even when nothing was found (then both teams "not_found"). Use the exact id strings.',
    'Prefer official club and competition pages and established news outlets; cite the page itself, not a search or aggregator page.',
    'A lineup is "confirmed" only if the club or competition has officially announced it for THIS match; otherwise "predicted" (a published predicted lineup) or "not_announced". Never use lineups from earlier matches.',
    'Return ONLY JSON: {"fixtures":[{"id":"...","teams":{"home":{"news":"reported|none_reported|not_found","source_url":""},"away":{"news":"...","source_url":""}},"lineup":{"status":"confirmed|predicted|not_announced","source_url":"","published_at":"","home":{"formation":"","starters":[{"name":"","number":0,"position":""}]},"away":{...}},"availability":[{"team":"home|away","player":"","position":"","status":"injured|suspended|doubtful|unavailable|available_again","detail":"","source_url":"","published_at":""}],"circumstances":[{"type":"rotation|manager|congestion|rest|weather|tactical|other","team":"home|away","detail":"","source_url":"","published_at":""}]}]}',
    'Fixtures:', ...lines, ...prior].join('\n');
}

function citedUrls(json) {
  const urls = new Set();
  for (const item of json?.output ?? []) {
    for (const c of item.content ?? []) for (const a of c.annotations ?? []) if (a.type === 'url_citation' && a.url) urls.add(normUrl(a.url));
    if (item.type === 'web_search_call') for (const s of item.action?.sources ?? []) if (s.url) urls.add(normUrl(s.url));
  }
  return urls;
}
const searchCount = json => (json?.output ?? []).filter(i => i.type === 'web_search_call' && (i.action?.type ?? 'search') === 'search').length;

// Strict JSON Schema for the research answer (Structured Outputs): every field required; "" or [] when unknown.
const S = values => ({type: 'string', ...(values ? {enum: values} : {})});
const obj = props => ({type: 'object', additionalProperties: false, required: Object.keys(props), properties: props});
const SOURCED = {source_url: S(), published_at: S()};
const LINEUP_SIDE = obj({formation: S(), starters: {type: 'array', items: obj({name: S(), number: {type: ['integer', 'null']}, position: S()})}});
const TEAM_NEWS = obj({news: S(['reported', 'none_reported', 'not_found']), source_url: S()});
export const RESEARCH_SCHEMA = obj({fixtures: {type: 'array', items: obj({
  id: S(),
  teams: obj({home: TEAM_NEWS, away: TEAM_NEWS}),
  lineup: obj({status: S(['confirmed', 'predicted', 'not_announced']), ...SOURCED, home: LINEUP_SIDE, away: LINEUP_SIDE}),
  availability: {type: 'array', items: obj({team: S(['home', 'away']), player: S(), position: S(), status: S(['injured', 'suspended', 'doubtful', 'unavailable', 'available_again']), detail: S(), ...SOURCED})},
  circumstances: {type: 'array', items: obj({type: S(['rotation', 'manager', 'congestion', 'rest', 'weather', 'tactical', 'other']), team: S(['home', 'away']), detail: S(), ...SOURCED})},
})}});

/** Complete fixture objects from a damaged or truncated answer (string-aware brace matching; nothing is invented). */
export function salvageFixtures(text) {
  const BS = String.fromCharCode(92), start = text.indexOf('"fixtures"'), out = [];
  let i = start < 0 ? -1 : text.indexOf('[', start);
  if (i < 0) return out;
  for (i++; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, str = false, esc = false, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (str) { if (esc) esc = false; else if (c === BS) esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; }
    }
    if (j >= text.length) break;                                  // truncated object: dropped, never completed by guessing
    try { const v = JSON.parse(text.slice(i, j + 1)); if (v && typeof v.id === 'string') out.push(v); } catch { /* malformed object: skipped */ }
    i = j;
  }
  return out;
}

/** Read a Responses API answer: refusal, empty, strict JSON, JSON inside prose, or salvaged complete objects. */
export function readAnswer(json) {
  const parts = (json?.output ?? []).filter(i => i.type === 'message').flatMap(i => i.content ?? []);
  const refusal = parts.find(c => c.type === 'refusal')?.refusal ?? null, text = parts.filter(c => c.type === 'output_text').map(c => c.text).join('');
  if (!text.trim()) return {parse: 'empty', fixtures: [], text, refusal};
  const list = v => Array.isArray(v?.fixtures) ? v.fixtures.filter(x => x && typeof x === 'object') : null;
  try { const v = list(JSON.parse(text)); if (v) return {parse: 'json', fixtures: v, text, refusal}; } catch { /* not strict JSON */ }
  try { const v = list(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))); if (v) return {parse: 'extracted', fixtures: v, text, refusal}; } catch { /* not a single JSON object */ }
  const salvaged = salvageFixtures(text);
  return {parse: salvaged.length ? 'salvaged' : 'malformed', fixtures: salvaged, text, refusal};
}

/** Why a paid request did or did not produce usable intelligence (stored on the request record). */
export function diagnose(results, answer = {}) {
  const sides = results.flatMap(r => ['home', 'away'].map(side => r.sides?.[side] ?? 'not_found')), count = v => sides.filter(x => x === v).length;
  const d = {fixtures: results.length, enriched: results.filter(r => r.outcome === 'enriched').length, teamsReported: count('reported'), teamsNoneReported: count('none_reported'), teamsNotFound: count('not_found'), teamsRejected: count('rejected'), rejected: {}};
  for (const r of results) for (const [k, v] of Object.entries(r.rejectedCounts ?? {})) d.rejected[k] = (d.rejected[k] ?? 0) + v;
  d.reason = d.enriched ? null
    : answer.missingIds === results.length ? 'answer did not include the requested fixture ids'
    : Object.keys(d.rejected).length ? `claims rejected: ${Object.entries(d.rejected).map(([k, v]) => `${k} ${v}`).join(', ')}`
    : d.teamsNotFound === sides.length ? 'search found no team news for any requested team'
    : 'no verified absences (teams with news reported none)';
  return d;
}

/** One batched research request. Returns per-fixture verified results and the cost record. */
export async function researchBatch(service, batch, {mode = 'availability', known = [], hostStats = {}} = {}) {
  const st = openaiState(service.env); if (!st.enabled) return {state: 'disabled', reason: st.reason};
  const s = service.store, prompt = buildPrompt(batch, known, mode), promptTokens = Math.ceil(prompt.length / 3.5), maxOut = outputBudget(st, batch.length);
  const reserveUsd = worstCase(st, promptTokens, maxOut);
  if (!await reserve(s, reserveUsd, st.budget)) return {state: 'budget', reason: `Budget cap $${st.budget} would be exceeded`, spentUsd: await spent(s)};
  let json, res;
  const ambiguous = async reason => {
    // The request may have been processed and billed (timeout, connection loss, server error): keep the full
    // worst-case reservation as spent, record it, and never retry automatically.
    const record = {id: null, at: s.now(), model: st.model, mode, fixtures: batch.length, searches: null, inputTokens: null, outputTokens: null, estimatedUsd: reserveUsd, actualUsd: reserveUsd, ambiguous: reason};
    await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
    return {state: 'ambiguous', reason, record};
  };
  // Structured Outputs (strict JSON Schema) with web search. If the API rejects the format (4xx: not processed, not
  // billed), the rejection is remembered and the same request is sent once with the prompt-only JSON contract.
  const schemaOff = Boolean((await s.cache('openai:schema-unsupported'))?.data);
  const send = useSchema => service.http.request('openai', ENDPOINT, {method: 'POST', fresh: true, store: false, noRetry: true, headers: {authorization: `Bearer ${service.env.OPENAI_API_KEY}`, 'content-type': 'application/json'},
    body: JSON.stringify({model: st.model, input: prompt, tools: [{type: 'web_search', search_context_size: st.searchContext}], max_tool_calls: st.maxSearches, max_output_tokens: maxOut, store: false, include: ['web_search_call.action.sources'],
      ...(useSchema ? {text: {format: {type: 'json_schema', name: 'fixture_research', strict: true, schema: RESEARCH_SCHEMA}}} : {})})});
  let schemaUsed = !schemaOff;
  try {
    res = await send(schemaUsed); json = await res.json().catch(() => null);
    if (schemaUsed && res.status >= 400 && res.status < 500 && /text\.format|json_schema|response_format|structured|schema/i.test(String(json?.error?.message ?? ''))) {
      await s.putCache('openai:schema-unsupported', {at: s.now(), status: res.status, message: String(json?.error?.message ?? '').slice(0, 200)}, 30 * 864e5);
      schemaUsed = false; res = await send(false); json = await res.json().catch(() => null);
    }
  } catch (e) {
    // Refused locally before sending (source budget, backoff): nothing was billed. Anything else is ambiguous.
    if (/budget exhausted|backoff active|disabled|not in the approved registry|Unknown source/i.test(e.message)) { await settle(s, reserveUsd, 0); throw e; }
    return ambiguous(String(e.message).slice(0, 120));
  }
  if (!res.ok) {
    if (res.status >= 500) return ambiguous(`HTTP ${res.status}`);
    await settle(s, reserveUsd, 0);   // 4xx: rejected before processing
    return {state: 'error', reason: `OpenAI HTTP ${res.status}: ${String(json?.error?.message ?? '').slice(0, 120)}`};
  }
  const searches = searchCount(json), cost = actualCost(st.model, json.usage, searches);
  await settle(s, reserveUsd, cost);
  const cited = citedUrls(json); cited.delete(null);
  const record = {id: json.id ?? null, at: s.now(), model: st.model, mode, fixtures: batch.length, fixtureIds: batch.map(f => f.id), searches, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, estimatedUsd: reserveUsd, actualUsd: cost, citedUrls: cited.size, schema: schemaUsed};
  await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
  // Never silently discard a paid answer: read it, recover what is recoverable locally, and record why the rest failed.
  const answer = readAnswer(json);
  record.answer = {status: json.status ?? null, incomplete: json.incomplete_details?.reason ?? null, parse: answer.parse, refusal: answer.refusal, fixturesReturned: answer.fixtures.length};
  if (!answer.fixtures.length) {
    record.unparsed = {kind: answer.refusal ? 'refused' : answer.parse === 'empty' ? 'empty' : record.answer.incomplete ? 'incomplete' : 'malformed', status: record.answer.status, incomplete: record.answer.incomplete, text: (answer.refusal ?? answer.text).slice(0, 400)};
    await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
    return {state: 'unparsed', record};
  }
  const parsed = {fixtures: answer.fixtures};
  const batchIds = new Set(batch.map(f => f.id));
  record.answer.unknownIds = parsed.fixtures.filter(x => x && typeof x.id === 'string' && !batchIds.has(x.id)).length;
  const byId = new Map(parsed.fixtures.filter(x => x && typeof x.id === 'string' && batchIds.has(x.id)).map(x => [x.id, x]));
  record.answer.missingIds = batch.filter(f => !byId.has(f.id)).length;
  // Verification reads the cited pages directly (not through the source registry, whose hosts are fixed): only URLs
  // this response's search returned, robots.txt honoured, nothing stored but the verdict. See source-verify.mjs.
  const loader = pageLoader(service.http?.fetcher ?? fetch, {deadline: service.runDeadline ? service.runDeadline - 30000 : Infinity, now: () => s.now()});
  // Fetch every cited page once, in parallel (bounded), so verification takes seconds even in a short run.
  const urls = [...new Set([...byId.values()].flatMap(x => [x.lineup?.source_url, x.teams?.home?.source_url, x.teams?.away?.source_url, ...(x.availability ?? []).map(a => a.source_url), ...(x.circumstances ?? []).map(c => c.source_url)]).filter(u => isUrl(u) && cited.has(normUrl(u))))].slice(0, 16);
  for (let i = 0; i < urls.length; i += 6) await Promise.all(urls.slice(i, i + 6).map(u => loader.load(u)));
  const results = [];
  for (const f of batch) results.push(await verifyAgainstSources(loader, validateFixtureResult(byId.get(f.id), f, cited, s.now()), f, hostStats));
  record.pages = loader.stats();
  record.diagnosis = diagnose(results, record.answer);
  await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
  return {state: 'ok', record, results, missing: batch.filter(f => !byId.has(f.id)).map(f => f.id)};
}

const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
/** Fixtures (and canonical siblings) for which a permitted provider already stored a team sheet / injuries. */
async function providerDetail(s, table, id) {
  return Boolean(await s.one(`SELECT 1 x FROM ${table} WHERE fixture_id=? OR fixture_id IN (SELECT b.fixture_id FROM fixture_identities a JOIN fixture_identities b ON b.canonical_id=a.canonical_id WHERE a.fixture_id=?) LIMIT 1`, id, id).catch(() => null));
}

/**
 * Scheduled stage: rolling 48 h, value-per-dollar priority (research-priority.mjs) across lineup checks (30-100 min
 * before the start) and availability research. Bounded per run (OPENAI_MAX_REQUESTS_PER_RUN), per day
 * (OPENAI_DAILY_BUDGET_USD) and in total (ledger). Measures efficiency per competition, batch size and source host.
 */
export async function researchUpcoming(service) {
  const st = openaiState(service.env), s = service.store, now = s.now();
  if (!st.enabled) return {outcome: 'success', state: 'disabled', reason: st.reason, processed: 0};
  const perRun = Math.max(0, Math.min(10, Number(service.env.OPENAI_MAX_REQUESTS_PER_RUN) || 3)), daily = Math.min(st.budget, Number(service.env.OPENAI_DAILY_BUDGET_USD) || 0.5);
  const dayKey = `openai:day:${s.day()}`, today = Number((await s.cache(dayKey))?.data?.usd ?? 0);
  const t0 = s.now();
  const out = {requests: 0, searches: 0, enriched: 0, reports: 0, confirmed: 0, predicted: 0, rejected: 0, usd: 0, reused: 0, stopped: null, chosen: null};
  const football = (await s.all("SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? AND status IN ('NS','TBD','TIMED','SCHEDULED') ORDER BY starts_at", now + 20 * 60000, now + 2 * 864e5)).map(r => ({...JSON.parse(r.payload), sport: 'football'})).filter(f => f.kickoffPrecision !== 'date');
  const nba = (await s.all("SELECT payload FROM basketball_games WHERE starts_at>? AND starts_at<? AND status='NS'", now + 20 * 60000, now + 2 * 864e5).catch(() => [])).map(r => JSON.parse(r.payload)).filter(g => g.timeKnown).map(g => ({id: g.id, startsAt: g.startsAt, home: g.home, away: g.away, competition: {id: 'nba', name: 'NBA', country: {name: 'United States'}}, sport: 'basketball'}));
  const rows = [...football, ...nba].sort((a, b) => a.startsAt - b.startsAt);
  // Planning reads in a few set queries (not per fixture): the stage runs last in the hourly job with little time.
  const cached = new Map((await s.all("SELECT id,payload FROM football_cache WHERE id LIKE 'research:%'")).map(r => [r.id, JSON.parse(r.payload)]));
  const records = new Map(); for (const f of rows) records.set(f.id, cached.get(`research:${f.id}`) ?? null);
  const stats = (await s.cache('openai:batch-stats'))?.data ?? {}, compStats = (await s.cache('openai:competition-stats'))?.data ?? {}, hostStats = (await s.cache('openai:source-stats'))?.data ?? {};
  const totalRequests = Object.values(stats).reduce((n, x) => n + (x.requests ?? 0), 0);
  // Team-level reuse: both teams researched in the last 24 h -> reuse instead of paying again.
  const teamFresh = new Map();
  for (const f of rows) for (const side of ['home', 'away']) if (!teamFresh.has(f[side].id)) { const t = cached.get(`research:team:${f[side].id}`); teamFresh.set(f[side].id, t && now - t.at < 24 * 3600000 ? t : null); }
  for (const f of rows) {
    if (records.get(f.id)) continue;
    const th = teamFresh.get(f.home.id), ta = teamFresh.get(f.away.id);
    if (th && ta) {
      const reused = {fixtureId: f.id, lineup: {status: 'not_announced'}, availability: [...th.items.map(a => ({...a, team: 'home'})), ...ta.items.map(a => ({...a, team: 'away'}))], circumstances: [], rejected: [], sides: {home: th.state ?? 'reported', away: ta.state ?? 'reported'}, outcome: 'enriched', verifiedAt: Math.min(th.at, ta.at), reusedFrom: 'team research'};
      await s.putCache(`research:${f.id}`, reused, 7 * 864e5); records.set(f.id, reused); out.reused++;
    }
  }
  const hasForecast = new Map();
  const fc = new Set((await s.all('SELECT DISTINCT fixture_id FROM analysis_forecasts WHERE kickoff_at>? AND kickoff_at<? AND as_of<kickoff_at', now, now + 2 * 864e5 + 3600000)).map(r => r.fixture_id));
  const bp = new Set((await s.all('SELECT DISTINCT game_id FROM basketball_predictions WHERE starts_at>? AND starts_at<?', now, now + 2 * 864e5 + 3600000).catch(() => [])).map(r => r.game_id));
  for (const f of rows) hasForecast.set(f.id, f.sport === 'basketball' ? bp.has(f.id) : fc.has(f.id));
  const withInjuries = new Set((await s.all("SELECT DISTINCT a.fixture_id FROM fixture_identities a JOIN fixture_identities b ON b.canonical_id=a.canonical_id JOIN injuries i ON i.fixture_id=b.fixture_id WHERE a.fixture_id IN (SELECT id FROM fixtures WHERE starts_at>? AND starts_at<?) UNION SELECT DISTINCT i.fixture_id FROM injuries i JOIN fixtures f ON f.id=i.fixture_id WHERE f.starts_at>? AND f.starts_at<?", now, now + 2 * 864e5, now, now + 2 * 864e5).catch(() => [])).map(r => r.fixture_id));
  const size = chooseBatchSize(stats, Number(service.env.OPENAI_BATCH_SIZE) || 5);
  const costFor = n => { const k = String(n >= 15 ? 20 : n >= 8 ? 10 : 5), x = stats[k]; return x?.requests ? x.usd / x.requests : 0.012 + 0.0004 * n; };
  const ctxFor = async (f, mode) => ({now, comp: compStats[competitionKey(f)], totalRequests, hasForecast: hasForecast.get(f.id), record: records.get(f.id),
    teamCached: Boolean(teamFresh.get(f.home.id) || teamFresh.get(f.away.id)), providerLineup: mode === 'lineups' && f.sport === 'football' ? await providerDetail(s, 'lineups', f.id) : false});
  const lineupItems = [], availItems = [];
  for (const f of rows) {
    if (f.startsAt - now <= 100 * 60000) { if (records.get(f.id)?.lineup?.status !== 'confirmed') { const score = fixtureScore(f, 'lineups', await ctxFor(f, 'lineups')); if (score > 0) lineupItems.push({f, score}); } continue; }
    let score = fixtureScore(f, 'availability', await ctxFor(f, 'availability'));
    if (score > 0 && f.sport === 'football' && withInjuries.has(f.id)) score *= 0.3;   // a permitted provider already lists injuries
    if (score > 0) availItems.push({f, score});
  }
  const plan = [...planBatches(lineupItems, 5, costFor).map(p => ({...p, mode: 'lineups'})), ...planBatches(availItems, size, costFor).map(p => ({...p, mode: 'availability'}))].sort((a, b) => b.perDollar - a.perDollar);
  out.planMs = s.now() - t0;
  out.candidates = {lineups: lineupItems.length, availability: availItems.length, batches: plan.length, batchSize: size};
  // Low-yield backoff (production evidence: six consecutive paid requests found no usable team news). When the last
  // LOW_YIELD_N requests produced nothing, at most one exploratory request is sent per OPENAI_LOW_YIELD_BACKOFF_HOURS
  // (default 6; 0 disables) instead of one per hour, so money is not spent repeating an approach that is not working.
  const backoffH = Number(service.env.OPENAI_LOW_YIELD_BACKOFF_HOURS ?? 6), LOW_YIELD_N = 6;
  if (backoffH > 0) {
    const recent = (await s.all("SELECT payload FROM football_cache WHERE id LIKE 'openai:req:%' ORDER BY updated_at DESC LIMIT ?", LOW_YIELD_N)).map(r => { const p = JSON.parse(r.payload); return p?.data ?? p; });
    const productive = r => (r?.diagnosis?.enriched ?? 0) + (r?.diagnosis?.teamsReported ?? 0) + (r?.diagnosis?.teamsNoneReported ?? 0) > 0;
    const lastAt = Math.max(0, ...recent.map(r => Number(r?.at) || 0));
    if (recent.length >= LOW_YIELD_N && !recent.some(productive) && now - lastAt < backoffH * 3600000) {
      out.stopped = 'low-yield backoff'; out.backoffUntil = lastAt + backoffH * 3600000; plan.length = 0;
    }
  }
  for (const job of plan) {
    if (out.requests >= perRun) { out.stopped = 'per-run limit'; break; }
    if (today + out.usd >= daily) { out.stopped = 'daily budget slice'; break; }
    if (service.runDeadline && s.now() > service.runDeadline - 75000) { out.stopped = 'run deadline'; break; }
    const known = job.batch.map(f => records.get(f.id)).filter(Boolean).map(r => ({id: r.fixtureId, status: r.lineup?.status ?? 'unknown', players: r.availability?.length || 0}));
    out.chosen = out.chosen ?? {mode: job.mode, fixtures: job.batch.length, competitions: job.keys, value: Number(job.value.toFixed(3)), perDollar: Number(job.perDollar.toFixed(1))};
    const r = await researchBatch(service, job.batch, {mode: job.mode, known, hostStats});
    if (r.state === 'budget') { out.stopped = 'total budget'; break; }
    if (r.state === 'disabled') break;
    if (r.state === 'ambiguous') { out.requests++; out.usd += r.record.actualUsd; out.stopped = `ambiguous request (${r.reason}); stopping this run`; break; }
    out.requests++;
    if (r.record) { out.searches += r.record.searches; out.usd += r.record.actualUsd; }
    if (r.state === 'unparsed') {
      // Every paid search counts: an unusable answer is a failed attempt for this batch size and these competitions,
      // so the planner's success estimate falls instead of repeating the same request.
      const k = String(job.batch.length >= 15 ? 20 : job.batch.length >= 8 ? 10 : 5), b = stats[k] ?? {requests: 0, fixtures: 0, enriched: 0, usd: 0, searches: 0};
      if (job.mode === 'availability') { b.requests++; b.fixtures += job.batch.length; b.usd += r.record.actualUsd; b.searches += r.record.searches ?? 0; bump(b, 'unparsed'); stats[k] = b; }
      for (const fx of job.batch) { const ck = competitionKey(fx), c = compStats[ck] ?? {name: fx.competition?.name ?? ck, availability: {}, lineups: {}}, m = c[job.mode === 'lineups' ? 'lineups' : 'availability'];
        bump(m, 'fixtures'); bump(m, 'usd', r.record.actualUsd / job.batch.length); m.lastAt = s.now(); bump(m, 'outcome_unparsed'); compStats[ck] = c; }
      for (const ck of job.keys) { const c = compStats[ck]; if (c) bump(c[job.mode === 'lineups' ? 'lineups' : 'availability'], 'requests'); }
      out.unparsed = (out.unparsed ?? 0) + 1;
      continue;
    }
    if (r.state !== 'ok') continue;
    const share = r.record.actualUsd / job.batch.length, sizeKey = String(job.batch.length >= 15 ? 20 : job.batch.length >= 8 ? 10 : 5);
    const bs = stats[sizeKey] ?? {requests: 0, fixtures: 0, enriched: 0, usd: 0, searches: 0};
    if (job.mode === 'availability') { bs.requests++; bs.fixtures += job.batch.length; bs.usd += r.record.actualUsd; bs.searches += r.record.searches ?? 0; }
    for (const v of r.results) {
      const fx = job.batch.find(f => f.id === v.fixtureId), merged = mergeResearch(records.get(v.fixtureId), v, s.now());
      await s.putCache(`research:${v.fixtureId}`, merged, 7 * 864e5);
      for (const side of ['home', 'away']) {
        const items = merged.availability.filter(a => a.team === side).map(a => { const c = {...a}; delete c.team; return c; });
        if (items.length || merged.sides?.[side] === 'none_reported') await s.putCache(`research:team:${fx[side].id}`, {items, state: items.length ? 'reported' : 'none_reported', at: s.now(), fromFixture: fx.id}, 3 * 864e5);
      }
      try { if (fx.sport === 'basketball') { const {recordBasketballSnapshot} = await import('../basketball/shadow.mjs'); await recordBasketballSnapshot(service, fx, merged); } else await recordShadowSnapshot(service, fx, merged); } catch { out.shadowErrors = (out.shadowErrors ?? 0) + 1; }
      const enriched = v.outcome === 'enriched', reports = v.availability.length, rejected = Object.values(v.rejectedCounts ?? {}).reduce((n, x) => n + x, 0);
      if (enriched) out.enriched++; out.reports += reports; out.rejected += rejected;
      if (v.lineup.status === 'confirmed') out.confirmed++; if (v.lineup.status === 'predicted') out.predicted++;
      if (job.mode === 'availability') { if (enriched) bs.enriched++; bump(bs, 'reports', reports); bump(bs, 'rejected', rejected); bump(bs, 'duplicates', v.duplicates ?? 0); }
      // Per competition: availability and lineup success are learned separately; cost is shared equally.
      const ck = competitionKey(fx), c = compStats[ck] ?? {name: fx.competition?.name ?? ck, availability: {}, lineups: {}}, m = c[job.mode === 'lineups' ? 'lineups' : 'availability'];
      bump(m, 'fixtures'); bump(m, 'usd', share); m.lastAt = s.now(); bump(m, `outcome_${v.outcome}`);
      if (job.mode === 'lineups') { if (v.lineup.status === 'confirmed') bump(m, 'confirmed'); if (v.lineup.status === 'predicted') bump(m, 'predicted'); }
      else { if (enriched) bump(m, 'enriched'); bump(m, 'reports', reports); bump(m, 'rejected', rejected); }
      for (const [reason, n] of Object.entries(v.rejectedCounts ?? {})) bump(c.rejectedReasons ??= {}, reason, n);
      compStats[ck] = c;
    }
    for (const ck of job.keys) { const c = compStats[ck]; if (c) bump(c[job.mode === 'lineups' ? 'lineups' : 'availability'], 'requests'); }
    if (job.mode === 'availability') stats[sizeKey] = bs;
  }
  await s.putCache('openai:batch-stats', stats, 90 * 864e5);
  await s.putCache('openai:competition-stats', compStats, 120 * 864e5);
  await s.putCache('openai:source-stats', hostStats, 120 * 864e5);
  await s.putCache(dayKey, {usd: today + out.usd}, 3 * 864e5);
  await s.putCache('openai:last-run', {...out, at: s.now(), spentUsd: await spent(s), budgetUsd: st.budget}, 30 * 864e5);
  return {outcome: 'success', ...out};
}

/** Efficiency summary from the measured statistics (for the status view and reports). */
export function efficiency(stats = {}, compStats = {}, hostStats = {}) {
  const per = (usd, n) => n ? Number((usd / n).toFixed(4)) : null;
  const bySize = Object.fromEntries(Object.entries(stats).map(([k, x]) => [k, {requests: x.requests, fixtures: x.fixtures, enriched: x.enriched, reports: x.reports ?? 0, usd: Number((x.usd ?? 0).toFixed(4)), usdPerEnriched: per(x.usd, x.enriched), usdPerReport: per(x.usd, x.reports), findingsPerSearch: x.searches ? Number(((x.reports ?? 0) / x.searches).toFixed(2)) : null, rejected: x.rejected ?? 0, duplicates: x.duplicates ?? 0}]));
  const byCompetition = Object.fromEntries(Object.entries(compStats).map(([k, c]) => [c.name ?? k, {availability: {...c.availability, usdPerEnriched: per(c.availability?.usd, c.availability?.enriched), successRate: c.availability?.fixtures ? Number(((c.availability.enriched ?? 0) / c.availability.fixtures).toFixed(2)) : null}, lineups: {...c.lineups, usdPerConfirmed: per(c.lineups?.usd, c.lineups?.confirmed)}, rejectedReasons: c.rejectedReasons ?? {}}]));
  const sources = Object.fromEntries(Object.entries(hostStats).sort((a, b) => b[1].claims - a[1].claims).slice(0, 30).map(([h, x]) => [h, {...x, reliability: x.claims ? Number((x.verified / x.claims).toFixed(2)) : null}]));
  return {bySize, byCompetition, sources};
}

/**
 * Batch size from measured efficiency: each of 5, 10 and 20 is tried twice; then the size with the most enriched
 * fixtures per dollar among sizes that enrich at least half of the fixtures asked about (ties: smaller).
 */
export function chooseBatchSize(stats, fallback = 5) {
  for (const k of ['5', '10', '20']) if ((stats[k]?.requests ?? 0) < 2) return Number(k);
  const ok = ['5', '10', '20'].filter(k => stats[k].fixtures && stats[k].enriched / stats[k].fixtures >= 0.5 && stats[k].usd > 0);
  if (!ok.length) return fallback;
  return Number(ok.sort((a, b) => stats[b].enriched / stats[b].usd - stats[a].enriched / stats[a].usd || Number(a) - Number(b))[0]);
}
