// GeminiSportsIntelligence: evidence-bound explanations of Mnemba's own verified data and forecasts.
// Deliberately WITHOUT Grounding with Google Search: the Gemini API terms (effective 2026-03-23) forbid storing
// grounded results or showing them to anyone but the requesting user, and Gemini 3.x grounding is not free.
// Plain generation from facts supplied here has no such restriction. Every number in the output must be one of the
// supplied facts and every point must cite them; otherwise the explanation is rejected and nothing is shown.
// Calls go through the source registry ('gemini'): daily budget, spacing, 429 backoff and the admin enable switch.
import {recordShadowSnapshot} from './shadow-model.mjs';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
async function scheduleFacts(s, teamId, kickoff) {
  const rows = await s.all("SELECT starts_at FROM fixtures WHERE (home_team_id=? OR away_team_id=?) AND starts_at<? AND starts_at>? AND status IN ('FT','AET','PEN','FINISHED') ORDER BY starts_at DESC LIMIT 10", teamId, teamId, kickoff, kickoff - 30 * 864e5);
  return {rest: rows.length ? (kickoff - Number(rows[0].starts_at)) / 864e5 : null, last14: rows.filter(r => kickoff - Number(r.starts_at) <= 14 * 864e5).length};
}
const BANNED = /\b(guarantee[sd]?|certain(ty)?|sure thing|lock|can't lose|cannot lose|risk-free)\b/i;

export function geminiState(env = {}) {
  if (String(env.GEMINI_ENABLED ?? '').toLowerCase() !== 'true') return {enabled: false, reason: 'GEMINI_ENABLED is not true'};
  if (!env.GEMINI_API_KEY) return {enabled: false, reason: 'GEMINI_API_KEY is not configured'};
  if (!/^[a-z0-9.-]+$/i.test(env.GEMINI_MODEL ?? '')) return {enabled: false, reason: 'GEMINI_MODEL must name a model explicitly'};
  if (String(env.GEMINI_PAID_USAGE_ALLOWED ?? 'false').toLowerCase() !== 'false') return {enabled: false, reason: 'Paid usage is not approved; GEMINI_PAID_USAGE_ALLOWED must be false'};
  return {enabled: true, model: env.GEMINI_MODEL};
}

/** Facts from a stored pre-match forecast and the fixture: each {id, label, value}. Only recorded values. */
export function factPack(f, forecast, research = null, sched = null) {
  const facts = [], add = (id, label, value) => { if (value != null && value !== '' && !(typeof value === 'number' && !Number.isFinite(value))) facts.push({id, label, value}); };
  add('home', 'Home team', f.home?.name); add('away', 'Away team', f.away?.name); add('competition', 'Competition', f.competition?.name);
  const p = forecast.probabilities ?? [];
  add('p_home', `Model probability ${f.home?.name} win (%)`, p[0] != null ? Math.round(p[0] * 100) : null);
  add('p_draw', 'Model probability draw (%)', p[1] != null ? Math.round(p[1] * 100) : null);
  add('p_away', `Model probability ${f.away?.name} win (%)`, p[2] != null ? Math.round(p[2] * 100) : null);
  const xg = forecast.expectedGoals ?? [];
  add('xg_home', `Model expected goals ${f.home?.name}`, xg[0] != null ? Number(xg[0].toFixed(1)) : null);
  add('xg_away', `Model expected goals ${f.away?.name}`, xg[1] != null ? Number(xg[1].toFixed(1)) : null);
  const fx = forecast.factors ?? {};
  for (const [side, key] of [['home', 'homeForm'], ['away', 'awayForm']]) {
    const fm = fx[key]; if (!fm) continue;
    add(`${side}_games`, `${f[side]?.name} recorded matches used`, fm.games);
    for (const k of ['wins', 'draws', 'losses']) add(`${side}_${k}`, `${f[side]?.name} ${k} in recent form`, fm[k]);
  }
  for (const [side, key] of [['home', 'home'], ['away', 'away']]) {
    const t = fx[key]; if (!t) continue;
    add(`${side}_scored`, `${f[side]?.name} goals scored per match (recent)`, Number.isFinite(t.scored) ? Number(t.scored.toFixed(1)) : null);
    add(`${side}_conceded`, `${f[side]?.name} goals conceded per match (recent)`, Number.isFinite(t.conceded) ? Number(t.conceded.toFixed(1)) : null);
  }
  // Verified pre-match research (cited sources) and schedule facts from Mnemba's own fixtures.
  if (research) {
    add('lineup_status', 'Lineup status', research.lineup?.status ?? 'not_announced');
    for (const side of ['home', 'away']) {
      const av = (research.availability ?? []).filter(a => a.team === side);
      add(`${side}_absent`, `${f[side]?.name} players reported injured, suspended or unavailable`, av.filter(a => ['injured', 'suspended', 'unavailable'].includes(a.status)).length);
      add(`${side}_doubtful`, `${f[side]?.name} players reported doubtful`, av.filter(a => a.status === 'doubtful').length);
      const names = av.map(a => `${a.player} (${a.status.replace('_', ' ')})`).slice(0, 8).join('; ');
      if (names) add(`${side}_availability`, `${f[side]?.name} reported availability`, names);
      if (research.lineup?.status === 'confirmed' || research.lineup?.status === 'predicted') add(`${side}_formation`, `${f[side]?.name} formation (${research.lineup.status})`, research.lineup[side]?.formation ?? null);
    }
    (research.circumstances ?? []).slice(0, 4).forEach((c, i) => add(`circ_${i}`, `Reported ${c.type}`, c.detail));
  }
  if (sched) for (const side of ['home', 'away']) { add(`${side}_rest_days`, `${f[side]?.name} days since previous recorded match`, sched[side]?.rest != null ? Math.round(sched[side].rest) : null); add(`${side}_matches_14d`, `${f[side]?.name} recorded matches in previous 14 days`, sched[side]?.last14); }
  const h = fx.headToHead; if (h?.games) { add('h2h_games', 'Recorded head-to-head meetings', h.games); add('h2h_home_wins', `${f.home?.name} head-to-head wins`, h.homeWins); add('h2h_away_wins', `${f.away?.name} head-to-head wins`, h.awayWins); }
  return facts;
}

/** Validate a model response against the facts. Returns {points, caveat} or {error}. */
export function validateExplanation(raw, facts) {
  let data; try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {error: 'Response is not valid JSON'}; }
  if (!data || !Array.isArray(data.points) || data.points.length < 1 || data.points.length > 5) return {error: 'Expected 1-5 points'};
  const byId = new Map(facts.map(x => [x.id, x]));
  const allowed = new Set(facts.filter(x => typeof x.value === 'number').map(x => String(x.value)));
  const points = [];
  for (const pt of data.points) {
    if (typeof pt?.text !== 'string' || pt.text.length < 10 || pt.text.length > 320) return {error: 'Point text missing or too long'};
    if (!Array.isArray(pt.facts) || !pt.facts.length || pt.facts.some(id => !byId.has(id))) return {error: 'Point cites unknown or no facts'};
    if (BANNED.test(pt.text)) return {error: 'Point claims certainty'};
    for (const n of pt.text.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.has(String(Number(n)))) return {error: `Number ${n} is not a supplied fact`};
    points.push({text: pt.text.trim(), facts: pt.facts});
  }
  const caveat = typeof data.caveat === 'string' && data.caveat.length <= 240 && !BANNED.test(data.caveat) && !/\d/.test(data.caveat) ? data.caveat.trim() : null;
  const FACTORS = new Set(['lineup_strength', 'attack', 'defence', 'goalkeeper', 'missing_players', 'formation', 'midfield', 'form', 'home_away', 'rotation', 'fatigue', 'rest', 'congestion', 'opposition', 'tactics']);
  const factors = [];
  for (const fc of Array.isArray(data.factors) ? data.factors.slice(0, 14) : []) {
    if (!FACTORS.has(fc?.factor) || !['home', 'away', 'neither', 'unknown'].includes(fc?.favours)) continue;
    const strength = Number.isInteger(fc.strength) && fc.strength >= 0 && fc.strength <= 3 ? fc.strength : null;
    if (strength == null || !Array.isArray(fc.facts) || !fc.facts.length || fc.facts.some(id => !byId.has(id))) continue;   // no evidence, no factor
    factors.push({factor: fc.factor, favours: fc.favours, strength, facts: fc.facts});
  }
  const verdict = ['supports', 'contradicts', 'mixed', 'insufficient'].includes(data.verdict) ? data.verdict : 'insufficient';
  return {points, caveat, factors, verdict};
}

const SCHEMA = {type: 'OBJECT', properties: {verdict: {type: 'STRING', enum: ['supports', 'contradicts', 'mixed', 'insufficient']}, factors: {type: 'ARRAY', items: {type: 'OBJECT', properties: {factor: {type: 'STRING'}, favours: {type: 'STRING', enum: ['home', 'away', 'neither', 'unknown']}, strength: {type: 'INTEGER'}, facts: {type: 'ARRAY', items: {type: 'STRING'}}}, required: ['factor', 'favours', 'strength', 'facts']}}, points: {type: 'ARRAY', minItems: 1, maxItems: 5, items: {type: 'OBJECT', properties: {text: {type: 'STRING'}, facts: {type: 'ARRAY', items: {type: 'STRING'}}}, required: ['text', 'facts']}}, caveat: {type: 'STRING'}}, required: ['points']};

export async function generateExplanation(service, f, forecast, research = null, sched = null) {
  const st = geminiState(service.env); if (!st.enabled) return {state: 'disabled', reason: st.reason};
  const facts = factPack(f, forecast, research, sched); if (facts.length < 6) return {state: 'skipped', reason: 'Too few verified facts to explain'};
  // The configured daily limit (GEMINI_DAILY_REQUEST_LIMIT) is enforced here as well as by the source registry.
  const limit = Math.max(1, Math.min(1000, Number(service.env.GEMINI_DAILY_REQUEST_LIMIT) || 100));
  const used = Number((await service.store.one("SELECT used FROM source_request_usage WHERE source_id='gemini' AND day=?", service.store.day()))?.used ?? 0);
  if (used >= limit) throw new Error('Gemini local free-request budget exhausted');
  const prompt = ['You explain a football forecast for fans in plain English.', 'Use ONLY the facts below. Do not add players, injuries, tactics, news or any number that is not listed.',
    'Write 2-4 short points. Each point must list the fact ids it relies on. Describe probabilities as estimates, never as certainties. Add a one-sentence caveat without numbers.',
    'Also assess these factors where the facts allow: lineup_strength, attack, defence, goalkeeper, missing_players, formation, midfield, form, home_away, rotation, fatigue, rest, congestion, opposition, tactics. For each: favours home/away/neither/unknown, strength 0-3, and the fact ids. Omit a factor without supporting facts.',
    'Give a verdict: do the facts support, contradict, or give a mixed picture of the model probabilities (or insufficient)?',
    'Facts (id | label | value):', ...facts.map(x => `${x.id} | ${x.label} | ${x.value}`)].join('\n');
  const body = JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}], generationConfig: {temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json', responseSchema: SCHEMA}});
  // No `tools` field: no Google Search grounding, so no grounded-result terms and no grounding charges.
  const res = await service.http.request('gemini', `${ENDPOINT}${encodeURIComponent(st.model)}:generateContent`, {method: 'POST', headers: {'x-goog-api-key': service.env.GEMINI_API_KEY, 'content-type': 'application/json'}, body, fresh: true, store: false});
  if (!res.ok) return {state: 'error', reason: `Gemini HTTP ${res.status}`};
  const json = await res.json(), text = json?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  const usage = json?.usageMetadata ?? {};
  const v = validateExplanation(text, facts);
  return v.error ? {state: 'rejected', reason: v.error, usage} : {state: 'ok', points: v.points, caveat: v.caveat, factors: v.factors, verdict: v.verdict, facts, usage};
}

/** Scheduled stage: explain upcoming tracked forecasts (soonest first), bounded per run and by the daily budget. */
export async function explainUpcoming(service, {limit} = {}) {
  const s = service.store, now = s.now(), st = geminiState(service.env);
  if (!st.enabled) return {outcome: 'success', state: 'disabled', reason: st.reason, processed: 0};
  const max = Math.min(Number(limit ?? service.env.GEMINI_EXPLAIN_BATCH) || 8, 20), out = {processed: 0, ok: 0, rejected: 0, errors: 0, skipped: 0, inputTokens: 0, outputTokens: 0};
  const rows = await s.all("SELECT p.id,p.fixture_id,p.as_of,p.payload,f.payload fx FROM analysis_forecasts p JOIN fixtures f ON f.id=p.fixture_id WHERE p.model_version='poisson-temporal-1' AND p.kickoff_at>? AND p.kickoff_at<? AND p.as_of<p.kickoff_at ORDER BY p.kickoff_at,p.as_of DESC LIMIT 200", now, now + 2 * 864e5);
  const latest = new Map(); for (const r of rows) if (!latest.has(r.fixture_id)) latest.set(r.fixture_id, r);
  for (const r of latest.values()) {
    if (out.processed >= max) break;
    if (service.runDeadline && s.now() > service.runDeadline - 45000) break;
    const key = `ai-explain:${r.fixture_id}`, prior = await s.cache(key), research = (await s.cache(`research:${r.fixture_id}`))?.data ?? null;
    if (prior?.data?.forecastId === r.id && (prior.data.researchAt ?? null) === (research?.verifiedAt ?? null)) continue;
    out.processed++;
    try {
      const f = JSON.parse(r.fx), sched = {home: await scheduleFacts(s, f.home.id, f.startsAt), away: await scheduleFacts(s, f.away.id, f.startsAt)};
      const result = await generateExplanation(service, f, JSON.parse(r.payload), research, sched);
      out.inputTokens += result.usage?.promptTokenCount ?? 0; out.outputTokens += result.usage?.candidatesTokenCount ?? 0;
      if (result.state === 'ok') { out.ok++; await s.putCache(key, {forecastId: r.id, forecastAsOf: Number(r.as_of), researchAt: research?.verifiedAt ?? null, model: st.model, createdAt: s.now(), points: result.points, caveat: result.caveat, factors: result.factors, verdict: result.verdict, facts: result.facts}, 9 * 864e5);
        try { await recordShadowSnapshot(service, f, research, {factors: result.factors}); } catch {} }
      else if (result.state === 'rejected') { out.rejected++; await s.putCache(`${key}:rejected`, {forecastId: r.id, reason: result.reason, at: s.now()}, 864e5); }
      else out.skipped++;
    } catch (e) { out.errors++; if (/budget exhausted|retry deferred|429/i.test(e.message)) break; }
  }
  await s.putCache('gemini:last-run', {...out, at: s.now(), model: st.model}, 30 * 864e5);
  return {outcome: 'success', ...out};
}
