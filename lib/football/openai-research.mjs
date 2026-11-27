// OpenAI pre-match research (Responses API + web_search) for fixtures in the next 48 hours, under a hard $5 budget.
// - Facts only with a cited source; a lineup is CONFIRMED only with exactly 11 distinct starters and a cited source
//   published for this match; otherwise it is PREDICTED (with a source) or dropped.
// - Display rule (OpenAI web search guide): information from web results is shown with inline, clickable citations.
// - Budget: a concurrency-safe ledger (micro-USD) reserves the worst case before each request and reconciles with the
//   reported usage and the number of billed search actions afterwards. Requests stop before the cap.
// - Context only: research never changes probabilities (no adjustment has passed out-of-sample evaluation yet).
import {recordShadowSnapshot} from './shadow-model.mjs';
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

/** Validate one fixture result against the response's citations and the fixture. */
export function validateFixtureResult(r, fixture, cited, now) {
  const out = {fixtureId: fixture.id, lineup: {status: 'not_announced'}, availability: [], circumstances: [], rejected: []};
  // A source counts only if this response's web search actually returned or cited it.
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
      if (!valid) { out.rejected.push(`confirmed lineup failed checks (${need} distinct starters per team, cited source, published within 6 h of the start)`); status = src ? 'predicted' : null; }
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
  const sport = batch[0]?.sport === 'basketball' ? 'basketball' : 'football', starters = sport === 'basketball' ? 'starting five' : 'starting XI';
  const lines = batch.map(f => `- id=${f.id} | ${f.home.name} (home) v ${f.away.name} (away) | ${f.competition?.name ?? ''}${f.competition?.country?.name ? ' (' + f.competition.country.name + ')' : ''} | kickoff ${new Date(f.startsAt).toISOString()}`);
  const prior = known.length ? ['Already verified (do NOT search for these again; report only changes):', ...known.map(k => `- id=${k.id}: lineup ${k.status}${k.players ? '; availability known for ' + k.players : ''}`)] : [];
  return [
    `Research these ${sport} ${sport === 'basketball' ? 'games' : 'fixtures'} using web search. Focus: ${mode === 'lineups' ? `officially announced ${starters}` : sport === 'basketball' ? 'injury reports (out, doubtful/questionable), rest decisions, expected starting five, rotation changes' : 'injuries, suspensions, doubtful players, expected lineups, rotation, managerial changes, fixture congestion'}.`,
    'Rules: report only facts stated by a source you found in this search, with that exact source URL and its publication time (ISO 8601). Never guess.',
    'A lineup is "confirmed" only if the club or competition has officially announced it for THIS match; otherwise "predicted" (a published predicted lineup) or "not_announced". Never use lineups from earlier matches.',
    'Return ONLY JSON: {"fixtures":[{"id":"...","lineup":{"status":"confirmed|predicted|not_announced","source_url":"","published_at":"","home":{"formation":"","starters":[{"name":"","number":0,"position":""}]},"away":{...}},"availability":[{"team":"home|away","player":"","status":"injured|suspended|doubtful|unavailable|available_again","detail":"","source_url":"","published_at":""}],"circumstances":[{"type":"rotation|manager|congestion|rest|weather|tactical|other","detail":"","source_url":"","published_at":""}]}]}',
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
const outputText = json => (json?.output ?? []).filter(i => i.type === 'message').flatMap(i => i.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
const searchCount = json => (json?.output ?? []).filter(i => i.type === 'web_search_call' && (i.action?.type ?? 'search') === 'search').length;

/** One batched research request. Returns per-fixture validated results and the cost record. */
export async function researchBatch(service, batch, {mode = 'availability', known = []} = {}) {
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
  try {
    res = await service.http.request('openai', ENDPOINT, {method: 'POST', fresh: true, store: false, noRetry: true, headers: {authorization: `Bearer ${service.env.OPENAI_API_KEY}`, 'content-type': 'application/json'},
      body: JSON.stringify({model: st.model, input: prompt, tools: [{type: 'web_search', search_context_size: 'low'}], max_tool_calls: st.maxSearches, max_output_tokens: maxOut, store: false, include: ['web_search_call.action.sources']})});
    json = await res.json().catch(() => null);
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
  const record = {id: json.id ?? null, at: s.now(), model: st.model, mode, fixtures: batch.length, searches, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, estimatedUsd: reserveUsd, actualUsd: cost};
  await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
  const cited = citedUrls(json); cited.delete(null); record.citedUrls = cited.size; await s.putCache(`openai:req:${record.at}:${batch[0].id}`, record, 365 * 864e5);
  let parsed;
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
  const perRun = Math.max(0, Math.min(10, Number(service.env.OPENAI_MAX_REQUESTS_PER_RUN) || 3)), daily = Math.min(st.budget, Number(service.env.OPENAI_DAILY_BUDGET_USD) || 0.5);
  const dayKey = `openai:day:${s.day()}`, today = Number((await s.cache(dayKey))?.data?.usd ?? 0);
  const out = {requests: 0, searches: 0, enriched: 0, confirmed: 0, usd: 0, reused: 0, stopped: null};
  const football = (await s.all("SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? AND status IN ('NS','TBD','TIMED','SCHEDULED') ORDER BY starts_at", now + 20 * 60000, now + 2 * 864e5)).map(r => ({...JSON.parse(r.payload), sport: 'football'})).filter(f => f.kickoffPrecision !== 'date');
  // NBA games share the same window, priorities and budget (basketball tables exist only after the basketball release).
  const nba = (await s.all("SELECT payload FROM basketball_games WHERE starts_at>? AND starts_at<? AND status='NS'", now + 20 * 60000, now + 2 * 864e5).catch(() => [])).map(r => JSON.parse(r.payload)).filter(g => g.timeKnown).map(g => ({id: g.id, startsAt: g.startsAt, home: g.home, away: g.away, competition: {id: 'nba', name: 'NBA', country: {name: 'United States'}}, sport: 'basketball'}));
  const rows = [...football, ...nba].sort((a, b) => a.startsAt - b.startsAt);
  const records = new Map(); for (const f of rows) records.set(f.id, (await s.cache(`research:${f.id}`))?.data ?? null);
  const lineupDueFn = () => rows.filter(f => f.startsAt - now <= 100 * 60000 && records.get(f.id)?.lineup?.status !== 'confirmed');
  const availDueFn = lineupDue => rows.filter(f => !lineupDue.includes(f) && (!records.get(f.id) || now - records.get(f.id).verifiedAt > 24 * 3600000));
  const stats = (await s.cache('openai:batch-stats'))?.data ?? {};
  const size = chooseBatchSize(stats, Number(service.env.OPENAI_BATCH_SIZE) || 5);
  // Team-level reuse: a fixture with no record whose teams were both researched in the last 24 h reuses that
  // availability instead of paying to find it again.
  for (const f of rows) {
    if (records.get(f.id)) continue;
    const th = (await s.cache(`research:team:${f.home.id}`))?.data, ta = (await s.cache(`research:team:${f.away.id}`))?.data;
    if (th && ta && now - th.at < 24 * 3600000 && now - ta.at < 24 * 3600000) {
      const reused = {fixtureId: f.id, lineup: {status: 'not_announced'}, availability: [...th.items.map(a => ({...a, team: 'home'})), ...ta.items.map(a => ({...a, team: 'away'}))], circumstances: [], rejected: [], verifiedAt: Math.min(th.at, ta.at), reusedFrom: 'team research'};
      await s.putCache(`research:${f.id}`, reused, 7 * 864e5); records.set(f.id, reused); out.reused = (out.reused ?? 0) + 1;
    }
  }
  const groups = (list, mode) => { const by = new Map(); for (const f of list) { const k = f.competition?.id ?? 'other'; by.set(k, [...(by.get(k) ?? []), f]); } return [...by.values()].flatMap(g => { const out2 = []; for (let i = 0; i < g.length; i += size) out2.push({mode, batch: g.slice(i, i + size)}); return out2; }).sort((a, b) => a.batch[0].startsAt - b.batch[0].startsAt); };
  const lineupDue = lineupDueFn(), availDue = availDueFn(lineupDue);
  const lineupGroups = (() => { const by = new Map(); for (const f of lineupDue) { const k = f.competition?.id ?? 'other'; by.set(k, [...(by.get(k) ?? []), f]); } return [...by.values()].flatMap(g => { const o = []; for (let i = 0; i < g.length; i += 5) o.push({mode: 'lineups', batch: g.slice(i, i + 5)}); return o; }); })();
  for (const job of [...lineupGroups, ...groups(availDue, 'availability')]) {
    if (out.requests >= perRun) { out.stopped = 'per-run limit'; break; }
    if (today + out.usd >= daily) { out.stopped = 'daily budget slice'; break; }
    if (service.runDeadline && s.now() > service.runDeadline - 60000) { out.stopped = 'run deadline'; break; }
    const known = job.batch.map(f => records.get(f.id)).filter(Boolean).map(r => ({id: r.fixtureId, status: r.lineup?.status ?? 'unknown', players: r.availability?.length || 0}));
    const r = await researchBatch(service, job.batch, {mode: job.mode, known});
    if (r.state === 'budget') { out.stopped = 'total budget'; break; }
    if (r.state === 'disabled') break;
    if (r.state === 'ambiguous') { out.requests++; out.usd += r.record.actualUsd; out.stopped = `ambiguous request (${r.reason}); stopping this run`; break; }
    out.requests++;
    if (r.record) { out.searches += r.record.searches; out.usd += r.record.actualUsd; }
    if (r.state !== 'ok') continue;
    let complete = 0;
    for (const v of r.results) {
      const merged = mergeResearch(records.get(v.fixtureId), v, s.now());
      await s.putCache(`research:${v.fixtureId}`, merged, 7 * 864e5);
      const fx = job.batch.find(f => f.id === v.fixtureId);
      for (const side of ['home', 'away']) {
        const items = merged.availability.filter(a => a.team === side).map(a => { const c = {...a}; delete c.team; return c; });
        if (items.length) await s.putCache(`research:team:${fx[side].id}`, {items, at: s.now(), fromFixture: fx.id}, 3 * 864e5);
      }
      try { if (fx.sport === 'basketball') { const {recordBasketballSnapshot} = await import('../basketball/shadow.mjs'); await recordBasketballSnapshot(service, fx, merged); } else await recordShadowSnapshot(service, fx, merged); } catch { out.shadowErrors = (out.shadowErrors ?? 0) + 1; }
      if (v.lineup.status !== 'not_announced' || v.availability.length) { complete++; out.enriched++; }
      if (merged.lineup?.status === 'confirmed') out.confirmed++;
    }
    // Measured efficiency per batch size (availability research only; lineup checks always use small batches).
    if (job.mode === 'availability' && r.record) {
      const k = String(job.batch.length >= 15 ? 20 : job.batch.length >= 8 ? 10 : 5), st2 = stats[k] ?? {requests: 0, fixtures: 0, enriched: 0, usd: 0, searches: 0};
      stats[k] = {requests: st2.requests + 1, fixtures: st2.fixtures + job.batch.length, enriched: st2.enriched + complete, usd: st2.usd + r.record.actualUsd, searches: st2.searches + (r.record.searches ?? 0)};
      await s.putCache('openai:batch-stats', stats, 90 * 864e5);
    }
  }
  await s.putCache(dayKey, {usd: today + out.usd}, 3 * 864e5);
  await s.putCache('openai:last-run', {...out, at: s.now(), spentUsd: await spent(s), budgetUsd: st.budget}, 30 * 864e5);
  return {outcome: 'success', ...out};
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
