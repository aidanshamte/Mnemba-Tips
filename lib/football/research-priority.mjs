// Research prioritisation: which fixtures get the next paid search. Value per dollar, not kickoff order.
// score(fixture) = importance x timing x P(useful) x data value x novelty, where
// - importance: competition tier from the provider-independent name classifier (featuredCategory); NBA is top tier.
//   No per-match user-interest signal exists server-side (favourites are device-local), so none is invented.
// - timing: team news appears mostly in the last ~30 h; lineups need the 30-100 min window before the start.
// - P(useful): measured success of earlier requests for that competition (Beta prior from the tier) plus an exploration
//   bonus that shrinks with attempts and grows with time since the last try, so no league is excluded permanently.
// - data value: fixtures with a stored pre-kickoff forecast feed the shadow models; without one they are worth less.
// - novelty: fresh team-level research for one side halves the value; provider lineups/injuries already stored remove
//   the need for paid lineup research.
// Batches: fixtures sharing likely sources (same competition, then same country) are researched together; a batch's
// value is the sum of its fixtures' scores, divided by its measured (or estimated) cost.
import {featuredCategory} from './providers.mjs';
const TOP = new Set(['UEFA Champions League', 'UEFA Europa League', 'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'FIFA World Cup', 'European Championship', 'Copa América', 'African Cup of Nations']);

export function importance(f) {
  if (f.sport === 'basketball') return 1;
  const c = featuredCategory(f.competition ?? {}); return c ? (TOP.has(c) ? 1 : 0.75) : 0.35;
}
export const competitionKey = f => f.sport === 'basketball' ? 'nba' : String(f.competition?.id ?? 'other');
export const countryKey = f => f.sport === 'basketball' ? 'nba' : String(f.competition?.country?.name ?? f.competition?.id ?? 'other');

/** Timing weight by hours to the start for availability research. */
export function timing(hours) { return hours < 1.5 ? 0.6 : hours <= 30 ? 1 : hours <= 40 ? 0.7 : 0.45; }

/** P(useful) for a competition: Beta(1+2i, 3-2i) prior, measured enrichment, exploration bonus (bounded, >= 0.08). */
export function successEstimate(stat, imp, {totalRequests = 0, now = Date.now()} = {}) {
  const a0 = 1 + 2 * imp, b0 = 3 - 2 * imp, n = stat?.fixtures ?? 0, k = stat?.enriched ?? 0, tries = stat?.requests ?? 0;
  const mean = (a0 + k) / (a0 + b0 + n);
  const since = stat?.lastAt ? (now - stat.lastAt) / 864e5 : 30;
  const bonus = 0.2 * Math.sqrt(Math.log(2 + totalRequests) / (1 + tries)) * Math.min(1, 0.25 + since / 7);
  return Math.min(1, Math.max(0.08, mean) + bonus);
}

/** Score one fixture for a mode ('availability' | 'lineups'). ctx: {now, comp, totalRequests, hasForecast, teamCached, providerLineup, record}. */
export function fixtureScore(f, mode, ctx) {
  const hours = (f.startsAt - ctx.now) / 3600000, imp = importance(f);
  if (mode === 'lineups') {
    if (ctx.providerLineup) return 0;                              // already have a provider team sheet
    const st = ctx.comp?.lineups, p = successEstimate(st ? {fixtures: st.fixtures, enriched: st.confirmed, requests: st.requests, lastAt: st.lastAt} : null, imp, ctx);
    // One chance per match, and a confirmed XI is the most valuable single fact (shadow 'lineup' variant): weight 4.
    return 4 * imp * p * (ctx.hasForecast ? 1 : 0.4);
  }
  const rec = ctx.record, fresh = rec && ctx.now - rec.verifiedAt < 24 * 3600000;
  if (fresh) return 0;
  const notFoundRecently = rec && rec.outcome === 'not_found' && ctx.now - rec.verifiedAt < 36 * 3600000;
  return imp * timing(hours) * successEstimate(ctx.comp?.availability, imp, ctx) * (ctx.hasForecast ? 1 : 0.4) * (ctx.teamCached ? 0.5 : 1) * (notFoundRecently ? 0.5 : 1);
}

/**
 * Build candidate batches. items: [{f, score}] with score > 0. Groups by competition; a competition with fewer
 * fixtures than `size` is merged with others from the same country (shared national sources). Within a group the
 * highest-scoring fixtures go first. Returns [{batch, value, keys}] sorted by value per estimated dollar.
 */
export function planBatches(items, size, costFor = () => 1) {
  const byComp = new Map(); for (const it of items) { const k = competitionKey(it.f); byComp.set(k, [...(byComp.get(k) ?? []), it]); }
  const byCountry = new Map();
  for (const [k, list] of byComp) { const c = list.length >= size ? `comp:${k}` : `country:${countryKey(list[0].f)}`; byCountry.set(c, [...(byCountry.get(c) ?? []), ...list]); }
  const out = [];
  for (const list of byCountry.values()) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    for (let i = 0; i < sorted.length; i += size) {
      const part = sorted.slice(i, i + size), value = part.reduce((n, x) => n + x.score, 0);
      out.push({batch: part.map(x => x.f), value, perDollar: value / Math.max(1e-6, costFor(part.length)), keys: [...new Set(part.map(x => competitionKey(x.f)))]});
    }
  }
  return out.sort((a, b) => b.perDollar - a.perDollar || a.batch[0].startsAt - b.batch[0].startsAt);
}
