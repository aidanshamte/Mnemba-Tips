// Featured-match selection shared by the homepage carousel and the browser smoke test,
// so the test classifies exactly what the page would show.
import {competitionRank} from './featured-competitions.mjs';
export const FEATURED_LIMIT = 5;
export const PER_LEAGUE = 2;

/** Featured pool for a matchday response: stored picks when present, otherwise the matchday fixtures. */
export function featuredPool(matchday) {
  const picks = Array.isArray(matchday?.picks) ? matchday.picks : [], all = Array.isArray(matchday?.fixtures) ? matchday.fixtures : [];
  const byId = new Map(all.map(f => [f?.id, f]));
  // Picks carry the same fixture; take its canonical league from the matchday list so ordering sees it.
  return picks.length ? picks.map(e => ({...e.fixture, competitionCanonical: e.fixture?.competitionCanonical ?? byId.get(e.fixture?.id)?.competitionCanonical, recommendation: e.recommendation})) : all;
}

const leagueOf = f => f?.competitionCanonical ?? f?.competition?.id ?? f?.competition?.name ?? 'other';
/**
 * De-duplicated, capped list that the carousel rotates through. Favourite and featured leagues come first and no
 * league takes more than PER_LEAGUE slides while other leagues are available. Presentation only.
 */
export function featuredFixtures(pool, favourites = []) {
  const list = Array.isArray(pool) ? pool : [];
  const unique = list.filter((f, i) => f?.id && list.findIndex(g => g?.id === f.id) === i)
    .map((f, i) => ({f, i, r: competitionRank(f.competitionCanonical ?? '', favourites)}))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i).map(x => x.f);
  const out = [], count = new Map();
  for (const f of unique) { const k = leagueOf(f); if ((count.get(k) ?? 0) < PER_LEAGUE) { out.push(f); count.set(k, (count.get(k) ?? 0) + 1); } if (out.length >= FEATURED_LIMIT) return out; }
  for (const f of unique) { if (out.length >= FEATURED_LIMIT) break; if (!out.includes(f)) out.push(f); }
  return out;
}

/**
 * Classify a matchday API response for the homepage hero.
 * Throws when the response is an application failure (non-2xx or malformed) — that must never be
 * mistaken for "no eligible fixture".
 * @returns {{state:'carousel'|'single'|'none', count:number, range:{from?:string,to?:string}, probabilities:number, ids:string[]}}
 */
export function classifyFeatured(status, body) {
  if (!(status >= 200 && status < 300)) throw new Error(`Matchday request failed with HTTP ${status}`);
  if (!body || typeof body !== 'object' || !Array.isArray(body.fixtures) || !body.range) throw new Error('Matchday response is malformed (missing fixtures or range)');
  const featured = featuredFixtures(featuredPool(body));
  const probabilities = (Array.isArray(body.picks) ? body.picks : []).filter(p => Array.isArray(p?.analysis?.probabilities)).length;
  return {state: featured.length > 1 ? 'carousel' : featured.length === 1 ? 'single' : 'none', count: featured.length, range: {from: body.range.from, to: body.range.to}, probabilities, ids: featured.map(f => f.id)};
}
