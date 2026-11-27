// Featured-match selection shared by the homepage carousel and the browser smoke test,
// so the test classifies exactly what the page would show.
import {competitionRank} from './featured-competitions.mjs';
/** Featured pool for a matchday response: every qualifying pick (never plain fixtures standing in for picks). */
export function featuredPool(matchday) {
  const picks = Array.isArray(matchday?.picks) ? matchday.picks : [], all = Array.isArray(matchday?.fixtures) ? matchday.fixtures : [];
  const byId = new Map(all.map(f => [f?.id, f]));
  // Picks carry the same fixture; take its canonical league from the matchday list so ordering sees it.
  return picks.map(e => ({...e.fixture, competitionCanonical: e.fixture?.competitionCanonical ?? byId.get(e.fixture?.id)?.competitionCanonical, recommendation: e.recommendation, phase: e.phase ?? 'upcoming', savedAt: e.savedAt ?? null}));
}

const leagueOf = f => f?.competitionCanonical ?? f?.competition?.id ?? f?.competition?.name ?? 'other';
/**
 * Order every pick for the carousel: upcoming before started, favourite and featured leagues first, and leagues
 * interleaved so one league does not fill the opening slides. Ordering only: nothing is dropped (a former
 * FEATURED_LIMIT=5 / PER_LEAGUE=2 cap hid every qualifying pick after the fifth).
 */
export function featuredFixtures(pool, favourites = []) {
  const list = Array.isArray(pool) ? pool : [];
  const unique = list.filter((f, i) => f?.id && list.findIndex(g => g?.id === f.id) === i)
    .map((f, i) => ({f, i, started: f.phase && f.phase !== 'upcoming' ? 1 : 0, r: competitionRank(f.competitionCanonical ?? '', favourites)}))
    .sort((a, b) => a.started - b.started || a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i);
  const seen = new Map();   // round-robin rank within a league: 1st of each league, then 2nd of each, ...
  return unique.map(x => { const k = leagueOf(x.f), n = seen.get(k) ?? 0; seen.set(k, n + 1); return {...x, round: n}; })
    .sort((a, b) => a.started - b.started || a.round - b.round || a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i).map(x => x.f);
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
  const probabilities = (Array.isArray(body.picks) ? body.picks : []).filter(p => p?.recommendation?.primary).length;
  return {state: featured.length > 1 ? 'carousel' : featured.length === 1 ? 'single' : 'none', count: featured.length, range: {from: body.range.from, to: body.range.to}, probabilities, ids: featured.map(f => f.id)};
}
