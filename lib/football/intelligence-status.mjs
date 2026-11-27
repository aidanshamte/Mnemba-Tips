// Internal status (view=intelligence-status, internal token required): Gemini module, Wikidata matching, logo coverage.
// Never returns credentials: only whether they are configured.
import {geminiState} from './gemini-intelligence.mjs';
import {openaiState, spent, efficiency} from './openai-research.mjs';
import {shadowEvaluation} from './shadow-model.mjs';
import {basketballShadowStatus} from '../basketball/shadow.mjs';
import {visualCatalog, resolveVisual} from './visuals.mjs';

export async function intelligenceStatus(service) {
  const s = service.store, now = s.now(), day = s.day(), env = service.env ?? {};
  const g = geminiState(env), reg = await s.one("SELECT user_enabled,last_success,last_error,next_allowed_at FROM source_registry WHERE id='gemini'");
  const used = Number((await s.one("SELECT used FROM source_request_usage WHERE source_id='gemini' AND day=?", day))?.used ?? 0);
  const limit = Math.max(1, Math.min(1000, Number(env.GEMINI_DAILY_REQUEST_LIMIT) || 100));
  const count = async like => Number((await s.one('SELECT COUNT(*) n FROM football_cache WHERE id LIKE ? AND expires_at>?', like, now)).n);
  const wd = {};
  for (const r of await s.all("SELECT payload FROM football_cache WHERE id LIKE 'wdmatch:%' AND expires_at>?", now)) { const st = JSON.parse(r.payload).state ?? 'unknown'; wd[st] = (wd[st] ?? 0) + 1; }
  const cat = await visualCatalog(s), rows = await s.all('SELECT home_team_id h,away_team_id a,competition_id c FROM fixtures WHERE starts_at>? AND starts_at<?', now - 6 * 3600000, now + 2 * 864e5);
  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))], comps = [...new Set(rows.map(r => r.c))];
  return {
    at: now,
    gemini: {configured: Boolean(env.GEMINI_API_KEY), enabled: g.enabled, reason: g.reason ?? null, model: g.model ?? env.GEMINI_MODEL ?? null, grounding: 'not used (terms and cost)', paidUsageAllowed: false,
      adminEnabled: reg ? reg.user_enabled !== 0 : null, requestsToday: used, dailyLimit: limit, remainingToday: Math.max(0, limit - used), quotaResets: 'midnight UTC (local budget)',
      lastSuccess: reg?.last_success ?? null, lastError: reg?.last_error ?? null, backoffUntil: reg?.next_allowed_at > now ? reg.next_allowed_at : null,
      lastRun: (await s.cache('gemini:last-run'))?.data ?? null, explanationsStored: await count('ai-explain:%'), rejectedLastDay: await count('ai-explain:%:rejected'), estimatedCost: 0},
    openai: await (async () => {
      const o = openaiState(env), reqs = (await s.all("SELECT payload FROM football_cache WHERE id LIKE 'openai:req:%'")).map(r => JSON.parse(r.payload));
      const sum = k => reqs.reduce((n, r) => n + (Number(r[k]) || 0), 0), spentUsd = await spent(s), budget = o.budget ?? 5;
      const upcoming = await s.all("SELECT id FROM fixtures WHERE starts_at>? AND starts_at<? AND status IN ('NS','TBD','TIMED','SCHEDULED')", now, now + 2 * 864e5);
      let researched = 0, confirmed = 0, stale = 0;
      for (const r of upcoming) { const c = (await s.cache(`research:${r.id}`))?.data; if (!c) continue; researched++; if (c.lineup?.status === 'confirmed') confirmed++; if (now - c.verifiedAt > 24 * 3600000) stale++; }
      return {configured: Boolean(env.OPENAI_API_KEY), enabled: o.enabled, reason: o.reason ?? null, model: o.model ?? null, budgetUsd: budget, spentUsd, remainingUsd: Math.max(0, budget - spentUsd),
        requests: reqs.length, billedSearches: sum('searches'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), estimatedUsd: sum('estimatedUsd'), actualUsd: sum('actualUsd'),
        costPerEnrichedFixture: researched ? spentUsd / researched : null, fixtures48h: upcoming.length, researched, confirmedLineups: confirmed, stale, lastRun: (await s.cache('openai:last-run'))?.data ?? null,
        batchSize: (await s.cache('openai:batch-size'))?.data ?? null, probabilityEffect: 'none (context only until an adjustment passes out-of-sample evaluation)'};
    })(),
    shadowModel: await shadowEvaluation(service),
    basketball: await (async () => { try { const n = async q => Number((await s.one(q)).n); return {games: await n('SELECT COUNT(*) n FROM basketball_games'), finals: await n("SELECT COUNT(*) n FROM basketball_games WHERE status='FT'"), predictions: await n('SELECT COUNT(*) n FROM basketball_predictions'), grades: await n('SELECT COUNT(*) n FROM basketball_grades'), requestsToday: Number((await s.one("SELECT used FROM source_request_usage WHERE source_id='balldontlie' AND day=?", day))?.used ?? 0), lastSync: (await s.cache('bball:last-sync'))?.data ?? null, live: (await s.cache('bball:live-status'))?.data ?? null, evaluation: (await s.cache('bball:evaluation'))?.data?.result ?? null, shadow: await basketballShadowStatus(s)}; } catch (e) { return {error: String(e.message).slice(0, 120)}; } })(),
    batchStats: (await s.cache('openai:batch-stats'))?.data ?? null,
    researchEfficiency: efficiency((await s.cache('openai:batch-stats'))?.data ?? {}, (await s.cache('openai:competition-stats'))?.data ?? {}, (await s.cache('openai:source-stats'))?.data ?? {}),
    researchOutcomes: await (async () => { const o = {}; for (const r of await s.all("SELECT payload FROM football_cache WHERE id LIKE 'research:%' AND id NOT LIKE 'research:team:%'")) { const d = JSON.parse(r.payload).data ?? {}; const k = d.outcome ?? (d.availability?.length ? 'enriched' : 'not_found'); o[k] = (o[k] ?? 0) + 1; for (const side of ['home', 'away']) { const st = `side_${d.sides?.[side] ?? 'legacy'}`; o[st] = (o[st] ?? 0) + 1; } } return o; })(),
    wikidataMatch: {states: wd, requestsToday: Number((await s.one("SELECT used FROM source_request_usage WHERE source_id='wikidata' AND day=?", day))?.used ?? 0)},
    logos: {cohort: 'teams and competitions playing from 6 h ago to 48 h ahead', teams: {total: teams.length, verified: teams.filter(id => resolveVisual({id}, 'team', cat).verified).length}, competitions: {total: comps.length, verified: comps.filter(id => resolveVisual({id}, 'competition', cat).verified).length}},
    controls: 'Disable or enable a module with POST /api/intelligence {action:"source-policy",id:"openai"|"gemini"|"wikidata",enabled:false|true} (internal token).',
  };
}
