// Internal status (view=intelligence-status, internal token required): Gemini module, Wikidata matching, logo coverage.
// Never returns credentials: only whether they are configured.
import {geminiState} from './gemini-intelligence.mjs';
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
    wikidataMatch: {states: wd, requestsToday: Number((await s.one("SELECT used FROM source_request_usage WHERE source_id='wikidata' AND day=?", day))?.used ?? 0)},
    logos: {cohort: 'teams and competitions playing from 6 h ago to 48 h ahead', teams: {total: teams.length, verified: teams.filter(id => resolveVisual({id}, 'team', cat).verified).length}, competitions: {total: comps.length, verified: comps.filter(id => resolveVisual({id}, 'competition', cat).verified).length}},
    controls: 'Disable or enable a module with POST /api/intelligence {action:"source-policy",id:"gemini"|"wikidata",enabled:false|true} (internal token).',
  };
}
