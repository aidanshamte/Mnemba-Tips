// GeminiSportsIntelligence: evidence-bound explanations of Mnemba's own verified data and forecasts.
// Deliberately WITHOUT Grounding with Google Search: the Gemini API terms (effective 2026-03-23) forbid storing
// grounded results or showing them to anyone but the requesting user, and Gemini 3.x grounding is not free.
// Plain generation from facts supplied here has no such restriction. Every number in the output must be one of the
// supplied facts and every point must cite them; otherwise the explanation is rejected and nothing is shown.
// Calls go through the source registry ('gemini'): daily budget, spacing, 429 backoff and the admin enable switch.
import {recordShadowSnapshot, KNOWN_SIDE} from './shadow-model.mjs';

const GK = /goalkeeper|keeper|(^|[^a-z])gk($|[^a-z])|portero|goleiro/i, ABSENT = ['injured', 'suspended', 'unavailable'];
/** Per-team availability state from a research record: reported | none_reported | not_found | rejected | not_researched. */
export function sideState(research, side) {
  if (!research) return 'not_researched';
  return research.sides?.[side] ?? ((research.availability ?? []).some(a => a.team === side) ? 'reported' : 'not_found');
}
const STATE_LABEL = {reported: 'absences reported by a verified source', none_reported: 'a verified source reports no absences', not_found: 'UNKNOWN (no verified news found)', rejected: 'UNKNOWN (claims failed verification)', not_researched: 'UNKNOWN (not researched)'};
/** Availability facts for one team: counts only when known; unknown is stated as unknown, never as zero. */
export function availabilityFacts(add, research, side, name) {
  const state = sideState(research, side), av = (research?.availability ?? []).filter(a => a.team === side);
  add(`${side}_availability_status`, `${name} availability`, STATE_LABEL[state]);
  if (!KNOWN_SIDE.has(state)) return;
  add(`${side}_absent`, `${name} players reported injured, suspended or unavailable`, av.filter(a => ABSENT.includes(a.status)).length);
  add(`${side}_doubtful`, `${name} players reported doubtful`, av.filter(a => a.status === 'doubtful').length);
  if (av.some(a => ABSENT.includes(a.status) && GK.test(`${a.position ?? ''} ${a.detail ?? ''}`))) add(`${side}_gk_absent`, `${name} goalkeeper reported unavailable`, 'yes');
  const names = av.map(a => `${a.player}${a.position ? ' [' + a.position + ']' : ''} (${a.status.replace('_', ' ')})`).slice(0, 8).join('; ');
  if (names) add(`${side}_availability`, `${name} reported availability`, names);
}
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
  add('lineup_status', 'Lineup status', research ? research.lineup?.status ?? 'not_announced' : 'unknown (not researched)');
  for (const side of ['home', 'away']) {
    availabilityFacts(add, research, side, f[side]?.name);
    if (research?.lineup?.status === 'confirmed' || research?.lineup?.status === 'predicted') add(`${side}_formation`, `${f[side]?.name} formation (${research.lineup.status})`, research.lineup[side]?.formation ?? null);
  }
  (research?.circumstances ?? []).slice(0, 4).forEach((c, i) => add(`circ_${i}`, `Reported ${c.type}${c.team ? ' (' + f[c.team]?.name + ')' : ''}`, c.detail));
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
    // A number is supplied if it is a numeric fact value or appears in the label of a fact this point cites
    // (e.g. "matches in previous 14 days"); anything else is invented.
    const cited = new Set(pt.facts.flatMap(id => String(byId.get(id).label ?? '').match(/\d+(?:\.\d+)?/g) ?? []).map(n => String(Number(n))));
    for (const n of pt.text.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.has(String(Number(n))) && !cited.has(String(Number(n)))) return {error: `Number ${n} is not a supplied fact`};
    points.push({text: pt.text.trim(), facts: pt.facts});
  }
  // Generic explanations (only restating the probabilities) are rejected when team-specific evidence was supplied.
  const generic = id => /^(home|away|competition|p_home|p_draw|p_away|margin|total|lineup_status)$/.test(id) || /_availability_status$/.test(id);
  const specific = facts.filter(x => !generic(x.id)).length, specificPoints = points.filter(pt => pt.facts.some(id => !generic(id))).length;
  if (specific >= 3 && specificPoints < Math.ceil(points.length / 2)) return {error: 'Explanation is generic: too few points use team-specific evidence'};
  const caveat = typeof data.caveat === 'string' && data.caveat.length <= 240 && !BANNED.test(data.caveat) && !/\d/.test(data.caveat) ? data.caveat.trim() : null;
  const FACTORS = new Set(['lineup_strength', 'attack', 'defence', 'goalkeeper', 'missing_players', 'formation', 'midfield', 'form', 'home_away', 'rotation', 'fatigue', 'rest', 'congestion', 'opposition', 'tactics']);
  const factors = [];
  for (const fc of Array.isArray(data.factors) ? data.factors.slice(0, 14) : []) {
    if (!FACTORS.has(fc?.factor) || !['home', 'away', 'neither', 'unknown'].includes(fc?.favours)) continue;
    const strength = Number.isInteger(fc.strength) && fc.strength >= 0 && fc.strength <= 3 ? fc.strength : null;
    if (strength == null || !Array.isArray(fc.facts) || !fc.facts.length || fc.facts.some(id => !byId.has(id))) continue;   // no evidence, no factor
    factors.push({factor: fc.factor, favours: fc.favours, strength, facts: fc.facts});
  }
  const lean = ['home', 'draw', 'away', 'none'].includes(data.lean) ? data.lean : 'none';
  return {points, caveat, factors, lean};
}

// Model outputs are withheld from Gemini so its assessment is independent of the prediction it is compared with.
export const MODEL_FACT = id => ['p_home', 'p_draw', 'p_away', 'xg_home', 'xg_away', 'margin', 'total'].includes(id);

/**
 * Compare Gemini's independent lean with the model's favourite (computed here, not by the language model):
 * same side -> supports (mixed if a strong cited factor points the other way); opposite side -> contradicts;
 * a draw on either side -> mixed; no lean or no model probabilities -> insufficient.
 */
export function independentVerdict(lean, factors, facts) {
  const val = id => facts.find(x => x.id === id)?.value;
  const probs = [['home', val('p_home')], ['draw', val('p_draw')], ['away', val('p_away')]].filter(([, p]) => typeof p === 'number').sort((a, b) => b[1] - a[1]);
  const fav = probs.length ? probs[0][0] : null;
  if (!fav || !lean || lean === 'none') return {verdict: 'insufficient', modelFavourite: fav};
  const against = (factors ?? []).some(x => ['home', 'away'].includes(x.favours) && x.favours !== lean && x.strength >= 2);
  const verdict = lean === fav ? (against ? 'mixed' : 'supports') : lean === 'draw' || fav === 'draw' ? 'mixed' : 'contradicts';
  return {verdict, modelFavourite: fav};
}

const SCHEMA = {type: 'OBJECT', properties: {lean: {type: 'STRING', enum: ['home', 'draw', 'away', 'none']}, factors: {type: 'ARRAY', items: {type: 'OBJECT', properties: {factor: {type: 'STRING'}, favours: {type: 'STRING', enum: ['home', 'away', 'neither', 'unknown']}, strength: {type: 'INTEGER'}, facts: {type: 'ARRAY', items: {type: 'STRING'}}}, required: ['factor', 'favours', 'strength', 'facts']}}, points: {type: 'ARRAY', minItems: 1, maxItems: 5, items: {type: 'OBJECT', properties: {text: {type: 'STRING'}, facts: {type: 'ARRAY', items: {type: 'STRING'}}}, required: ['text', 'facts']}}, caveat: {type: 'STRING'}}, required: ['points', 'lean']};

export async function generateExplanation(service, f, forecast, research = null, sched = null) {
  return explainFacts(service, factPack(f, forecast, research, sched), 'football');
}

/** Shared core for both sports: the facts are the only evidence the model may use. */
export async function explainFacts(service, facts, sport = 'football') {
  const st = geminiState(service.env); if (!st.enabled) return {state: 'disabled', reason: st.reason};
  const evidence = facts.filter(x => !MODEL_FACT(x.id));
  if (evidence.length < 5) return {state: 'skipped', reason: 'Too few verified facts to assess'};
  // The configured daily limit (GEMINI_DAILY_REQUEST_LIMIT) is enforced here as well as by the source registry.
  const limit = Math.max(1, Math.min(1000, Number(service.env.GEMINI_DAILY_REQUEST_LIMIT) || 100));
  const used = Number((await service.store.one("SELECT used FROM source_request_usage WHERE source_id='gemini' AND day=?", service.store.day()))?.used ?? 0);
  if (used >= limit) throw new Error('Gemini local free-request budget exhausted');
  const factorList = sport === 'basketball' ? 'missing_players, form, home_away, rest, fatigue, opposition, rotation' : 'lineup_strength, attack, defence, goalkeeper, missing_players, formation, midfield, form, home_away, rotation, fatigue, rest, congestion, opposition, tactics';
  // Evidence first: no model probability, expected goals, margin or total is shown, so the lean is independent.
  const prompt = [`You are an independent ${sport} analyst. You are not shown any prediction: judge the match only from the facts below.`, 'Use ONLY these facts. Do not add players, injuries, tactics, news or any number that is not listed.',
    'Write 2-4 short points comparing the teams directly: strengths, weaknesses, significant absences, evidence for each outcome and evidence against it. Each point must list the fact ids it relies on. Never claim certainty. Add a one-sentence caveat without numbers naming the most important unknown.',
    'If the availability of a team is UNKNOWN, say it is unknown; never suggest a full squad or no injuries.',
    `Assess these factors where the facts allow: ${factorList}. For each: favours home/away/neither/unknown, strength 0-3, and the fact ids. Omit a factor without supporting facts.`,
    `Finally give your lean from the evidence: ${sport === 'basketball' ? 'home or away' : 'home, draw or away'}, or none if the evidence is insufficient or balanced. Do not lean only because a team is at home.`,
    'Facts (id | label | value):', ...evidence.map(x => `${x.id} | ${x.label} | ${x.value}`)].join('\n');
  const body = JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}], generationConfig: {temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: {thinkingLevel: 'low'}, responseMimeType: 'application/json', responseSchema: SCHEMA}});
  // No `tools` field: no Google Search grounding, so no grounded-result terms and no grounding charges.
  const res = await service.http.request('gemini', `${ENDPOINT}${encodeURIComponent(st.model)}:generateContent`, {method: 'POST', headers: {'x-goog-api-key': service.env.GEMINI_API_KEY, 'content-type': 'application/json'}, body, fresh: true, store: false});
  if (!res.ok) return {state: 'error', reason: `Gemini HTTP ${res.status}`};
  // Gemini 3.x models think before answering; thinking tokens count against maxOutputTokens, so thinking is kept low
  // and a truncated answer is reported as such (measured: 669 thinking tokens exhausted a 700-token limit).
  const json = await res.json(), text = json?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  const usage = json?.usageMetadata ?? {};
  if (json?.candidates?.[0]?.finishReason === 'MAX_TOKENS') return {state: 'rejected', reason: 'Response truncated (MAX_TOKENS)', usage};
  const v = validateExplanation(text, evidence);
  if (v.error) return {state: 'rejected', reason: v.error, usage};
  const lean = sport === 'basketball' && v.lean === 'draw' ? 'none' : v.lean, cmp = independentVerdict(lean, v.factors, facts);
  return {state: 'ok', points: v.points, caveat: v.caveat, factors: v.factors, lean, verdict: cmp.verdict, modelFavourite: cmp.modelFavourite, facts, usage};
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
      if (result.state === 'ok') { out.ok++; await s.putCache(key, {forecastId: r.id, forecastAsOf: Number(r.as_of), researchAt: research?.verifiedAt ?? null, model: st.model, createdAt: s.now(), points: result.points, caveat: result.caveat, factors: result.factors, verdict: result.verdict, lean: result.lean, modelFavourite: result.modelFavourite, facts: result.facts}, 9 * 864e5);
        try { await recordShadowSnapshot(service, f, research, {factors: result.factors}); } catch {} }
      else if (result.state === 'rejected') { out.rejected++; await s.putCache(`${key}:rejected`, {forecastId: r.id, reason: result.reason, at: s.now()}, 864e5); }
      else out.skipped++;
    } catch (e) { out.errors++; if (/budget exhausted|retry deferred|429/i.test(e.message)) break; }
  }
  await s.putCache('gemini:last-run', {...out, at: s.now(), model: st.model}, 30 * 864e5);
  return {outcome: 'success', ...out};
}
