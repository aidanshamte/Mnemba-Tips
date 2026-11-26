// OpenAI pre-match research (Responses API + web_search) for fixtures in the next 48 hours, under a hard $5 budget.
// - Facts only with a cited source; a lineup is CONFIRMED only with exactly 11 distinct starters and a cited source
//   published for this match; otherwise it is PREDICTED (with a source) or dropped.
// - Display rule (OpenAI web search guide): information from web results is shown with inline, clickable citations.
// - Budget: a concurrency-safe ledger (micro-USD) reserves the worst case before each request and reconciles with the
//   reported usage and the number of billed search actions afterwards. Requests stop before the cap.
// - Context only: research never changes probabilities (no adjustment has passed out-of-sample evaluation yet).
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
  return {enabled: true, model, budget, maxSearches: Math.max(1, Math.min(4, Number(env.OPENAI_MAX_SEARCHES_PER_REQUEST) || 3)), maxOutput: Math.max(600, Math.min(4000, Number(env.OPENAI_MAX_OUTPUT_TOKENS) || 2500))};
}

/** Worst-case cost of one request (USD). */
export function worstCase(st, promptTokens) {
  const p = PRICES[st.model];
  return st.maxSearches * (SEARCH_USD + p.searchBlock * p.input / MICRO) + (promptTokens + 1500) * p.input / MICRO + st.maxOutput * p.output / MICRO;
}
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

/** Validate one fixture result against the response's citations and the fixture. */
export function validateFixtureResult(r, fixture, cited, now) {
  const out = {fixtureId: fixture.id, lineup: {status: 'not_announced'}, availability: [], circumstances: [], rejected: []};
  const ok = url => isUrl(url) && (cited.size === 0 ? false : cited.has(url));
  const published = t => { const ms = Date.parse(t); return Number.isFinite(ms) && ms <= now + 3600000 ? ms : null; };
  const lu = r?.lineup;
  if (lu && ['confirmed', 'predicted'].includes(lu.status)) {
    const side = t => (Array.isArray(t?.starters) ? t.starters : []).map(p => ({name: String(p?.name ?? '').trim(), number: Number.isInteger(p?.number) ? p.number : null, position: typeof p?.position === 'string' ? p.position : null})).filter(p => p.name);
    const home = side(lu.home), away = side(lu.away), distinct = a => new Set(a.map(p => norm(p.name))).size;
    let status = lu.status;
    const src = ok(lu.source_url) ? lu.source_url : null, at = published(lu.published_at);
    if (status === 'confirmed') {
      const valid = home.length === 11 && away.length === 11 && distinct(home) === 11 && distinct(away) === 11 && src && at && at >= fixture.startsAt - 6 * 3600000;
      if (!valid) { out.rejected.push('confirmed lineup failed checks (11 distinct starters per team, cited source, published within 6 h of kickoff)'); status = src ? 'predicted' : null; }
    } else if (!src) status = null;
    if (status) out.lineup = {status, source: src, publishedAt: at, home: {formation: typeof lu.home?.formation === 'string' ? lu.home.formation : null, starters: home}, away: {formation: typeof lu.away?.formation === 'string' ? lu.away.formation : null, starters: away}};
  }
  for (const a of Array.isArray(r?.availability) ? r.availability : []) {
    const st = String(a?.status ?? '');
    if (!['injured', 'suspended', 'doubtful', 'unavailable', 'available_again'].includes(st) || !['home', 'away'].includes(a?.team) || !a?.player) { out.rejected.push('availability item malformed'); continue; }
    if (!ok(a.source_url)) { out.rejected.push(`availability for ${a.player} has no cited source`); continue; }
    out.availability.push({team: a.team, player: String(a.player).trim(), status: st, detail: typeof a.detail === 'string' ? a.detail.slice(0, 200) : null, source: a.source_url, publishedAt: published(a.published_at)});
  }
  for (const c of Array.isArray(r?.circumstances) ? r.circumstances : []) {
    if (!['rotation', 'manager', 'congestion', 'rest', 'weather', 'tactical', 'other'].includes(c?.type) || typeof c?.detail !== 'string') continue;
    if (!ok(c.source_url)) { out.rejected.push('circumstance without cited source'); continue; }
    out.circumstances.push({type: c.type, detail: c.detail.slice(0, 240), source: c.source_url, publishedAt: published(c.published_at)});
  }
  return out;
}

/** Merge a new validated result with the stored record (delta updates): confirmed beats predicted; newest availability wins. */
export function mergeResearch(prev, next, now) {
  if (!prev) return {...next, verifiedAt: now};
  const lineup = next.lineup.status === 'confirmed' || (next.lineup.status === 'predicted' && prev.lineup?.status !== 'confirmed') ? next.lineup : prev.lineup;
  const key = a => `${a.team}|${norm(a.player)}`, avail = new Map((prev.availability ?? []).map(a => [key(a), a]));
  for (const a of next.availability) { const old = avail.get(key(a)); if (!old || (a.publishedAt ?? 0) >= (old.publishedAt ?? 0)) avail.set(key(a), a); }
  const circ = [...(prev.circumstances ?? []), ...next.circumstances].filter((c, i, all) => all.findIndex(x => x.source === c.source && x.detail === c.detail) === i).slice(-12);
  return {...prev, lineup, availability: [...avail.values()], circumstances: circ, rejected: next.rejected, verifiedAt: now};
}

function buildPrompt(batch, known, mode) {
  const lines = batch.map(f => `- id=${f.id} | ${f.home.name} (home) v ${f.away.name} (away) | ${f.competition?.name ?? ''}${f.competition?.country?.name ? ' (' + f.competition.country.name + ')' : ''} | kickoff ${new Date(f.startsAt).toISOString()}`);
  const prior = known.length ? ['Already verified (do NOT search for these again; report only changes):', ...known.map(k => `- id=${k.id}: lineup ${k.status}${k.players ? '; availability known for ' + k.players : ''}`)] : [];
  return [
    `Research these football fixtures using web search. Focus: ${mode === 'lineups' ? 'officially announced starting lineups' : 'injuries, suspensions, doubtful players, expected lineups, rotation, managerial changes, fixture congestion'}.`,
    'Rules: report only facts stated by a source you found in this search, with that exact source URL and its publication time (ISO 8601). Never guess.',
    'A lineup is "confirmed" only if the club or competition has officially announced it for THIS match; otherwise "predicted" (a published predicted lineup) or "not_announced". Never use lineups from earlier matches.',
    'Return ONLY JSON: {"fixtures":[{"id":"...","lineup":{"status":"confirmed|predicted|not_announced","source_url":"","published_at":"","home":{"formation":"","starters":[{"name":"","number":0,"position":""}]},"away":{...}},"availability":[{"team":"home|away","player":"","status":"injured|suspended|doubtful|unavailable|available_again","detail":"","source_url":"","published_at":""}],"circumstances":[{"type":"rotation|manager|congestion|rest|weather|tactical|other","detail":"","source_url":"","published_at":""}]}]}',
    'Fixtures:', ...lines, ...prior].join('\n');
}

function citedUrls(json) {
  const urls = new Set();
  for (const item of json?.output ?? []) {
    for (const c of item.content ?? []) for (const a of c.annotations ?? []) if (a.type === 'url_citation' && a.url) urls.add(a.url.replace(/[?&]utm_source=openai$/, ''));
    if (item.type === 'web_search_call') for (const s of item.action?.sources ?? []) if (s.url) urls.add(s.url);
  }
  return urls;
}
const outputText = json => (json?.output ?? []).filter(i => i.type === 'message').flatMap(i => i.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
const searchCount = json => (json?.output ?? []).filter(i => i.type === 'web_search_call' && (i.action?.type ?? 'search') === 'search').length;

/** One batched research request. Returns per-fixture validated results and the cost record. */
export async function researchBatch(service, batch, {mode = 'availability', known = []} = {}) {
  const st = openaiState(service.env); if (!st.enabled) return {state: 'disabled', reason: st.reason};
  const s = service.store, prompt = buildPrompt(batch, known, mode), promptTokens = Math.ceil(prompt.length / 3.5);
  const reserveUsd = worstCase(st, promptTokens);
  if (!await reserve(s, reserveUsd, st.budget)) return {state: 'budget', reason: `Budget cap $${st.budget} would be exceeded`, spentUsd: await spent(s)};
  let json, res;
  try {
    res = await service.http.request('openai', ENDPOINT, {method: 'POST', fresh: true, store: false, headers: {authorization: `Bearer ${service.env.OPENAI_API_KEY}`, 'content-type': 'application/json'},
      body: JSON.stringify({model: st.model, input: prompt, tools: [{type: 'web_search', search_context_size: 'low'}], max_tool_calls: st.maxSearches, max_output_tokens: st.maxOutput, store: false})});
    json = await res.json().catch(() => null);
  } catch (e) { await settle(s, reserveUsd, 0); throw e; }
  if (!res.ok) { await settle(s, reserveUsd, 0); return {state: 'error', reason: `OpenAI HTTP ${res.status}: ${String(json?.error?.message ?? '').slice(0, 120)}`}; }
  const searches = searchCount(json), cost = actualCost(st.model, json.usage, searches);
  await settle(s, reserveUsd, cost);
  const record = {id: json.id ?? null, at: s.now(), model: st.model, mode, fixtures: batch.length, searches, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, estimatedUsd: reserveUsd, actualUsd: cost};
  await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
  const cited = citedUrls(json); let parsed;
  try { const t = outputText(json); parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {state: 'unparsed', record}; }
  const byId = new Map((parsed?.fixtures ?? []).filter(x => x && typeof x.id === 'string').map(x => [x.id, x]));
  const results = batch.map(f => validateFixtureResult(byId.get(f.id), f, cited, s.now()));
  return {state: 'ok', record, results, missing: batch.filter(f => !byId.has(f.id)).map(f => f.id)};
}

/**
 * Scheduled stage: rolling 48 h. Priority 1: lineups for kickoffs 30–100 min away without a confirmed lineup.
 * Priority 2: availability research for fixtures with no record or a record older than 24 h (soonest first).
 * Bounded per run (OPENAI_MAX_REQUESTS_PER_RUN, default 3) and per day (OPENAI_DAILY_BUDGET_USD, default 0.75).
 */
export async function researchUpcoming(service) {
  const st = openaiState(service.env), s = service.store, now = s.now();
  if (!st.enabled) return {outcome: 'success', state: 'disabled', reason: st.reason, processed: 0};
  const perRun = Math.max(0, Math.min(10, Number(service.env.OPENAI_MAX_REQUESTS_PER_RUN) || 3)), daily = Math.min(st.budget, Number(service.env.OPENAI_DAILY_BUDGET_USD) || 0.75);
  const dayKey = `openai:day:${s.day()}`, today = Number((await s.cache(dayKey))?.data?.usd ?? 0);
  const out = {requests: 0, searches: 0, enriched: 0, confirmed: 0, usd: 0, stopped: null};
  const rows = (await s.all("SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? AND status IN ('NS','TBD','TIMED','SCHEDULED') ORDER BY starts_at", now + 20 * 60000, now + 2 * 864e5)).map(r => JSON.parse(r.payload)).filter(f => f.kickoffPrecision !== 'date');
  const records = new Map(); for (const f of rows) records.set(f.id, (await s.cache(`research:${f.id}`))?.data ?? null);
  const lineupDue = rows.filter(f => f.startsAt - now <= 100 * 60000 && records.get(f.id)?.lineup?.status !== 'confirmed');
  const availDue = rows.filter(f => !lineupDue.includes(f) && (!records.get(f.id) || now - records.get(f.id).verifiedAt > 24 * 3600000));
  let size = Math.max(3, Math.min(10, Number((await s.cache('openai:batch-size'))?.data?.size) || Number(service.env.OPENAI_BATCH_SIZE) || 5));
  const groups = (list, mode) => { const by = new Map(); for (const f of list) { const k = f.competition?.id ?? 'other'; by.set(k, [...(by.get(k) ?? []), f]); } return [...by.values()].flatMap(g => { const out2 = []; for (let i = 0; i < g.length; i += size) out2.push({mode, batch: g.slice(i, i + size)}); return out2; }).sort((a, b) => a.batch[0].startsAt - b.batch[0].startsAt); };
  for (const job of [...groups(lineupDue, 'lineups'), ...groups(availDue, 'availability')]) {
    if (out.requests >= perRun) { out.stopped = 'per-run limit'; break; }
    if (today + out.usd >= daily) { out.stopped = 'daily budget slice'; break; }
    if (service.runDeadline && s.now() > service.runDeadline - 60000) { out.stopped = 'run deadline'; break; }
    const known = job.batch.map(f => records.get(f.id)).filter(Boolean).map(r => ({id: r.fixtureId, status: r.lineup?.status ?? 'unknown', players: r.availability?.length || 0}));
    const r = await researchBatch(service, job.batch, {mode: job.mode, known});
    if (r.state === 'budget') { out.stopped = 'total budget'; break; }
    if (r.state === 'disabled') break;
    out.requests++;
    if (r.record) { out.searches += r.record.searches; out.usd += r.record.actualUsd; }
    if (r.state !== 'ok') continue;
    let complete = 0;
    for (const v of r.results) {
      const merged = mergeResearch(records.get(v.fixtureId), v, s.now());
      await s.putCache(`research:${v.fixtureId}`, merged, 7 * 864e5);
      if (v.lineup.status !== 'not_announced' || v.availability.length) { complete++; out.enriched++; }
      if (merged.lineup?.status === 'confirmed') out.confirmed++;
    }
    // Adaptive batch size from measured completeness (fixtures with any sourced finding / fixtures asked).
    const rate = complete / job.batch.length; size = rate < 0.5 ? Math.max(3, size - 2) : rate > 0.8 ? Math.min(10, size + 1) : size;
    await s.putCache('openai:batch-size', {size, lastRate: rate, at: s.now()}, 30 * 864e5);
  }
  await s.putCache(dayKey, {usd: today + out.usd}, 3 * 864e5);
  await s.putCache('openai:last-run', {...out, at: s.now(), spentUsd: await spent(s), budgetUsd: st.budget}, 30 * 864e5);
  return {outcome: 'success', ...out};
}
