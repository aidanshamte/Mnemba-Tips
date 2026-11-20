// Featured-match selection shared by the homepage carousel and the browser smoke test,
// so the test classifies exactly what the page would show.
export const FEATURED_LIMIT = 5;

/** Featured pool for a matchday response: stored picks when present, otherwise the matchday fixtures. */
export function featuredPool(matchday) {
  const picks = Array.isArray(matchday?.picks) ? matchday.picks : [];
  return picks.length ? picks.map(e => ({...e.fixture, recommendation: e.recommendation})) : (Array.isArray(matchday?.fixtures) ? matchday.fixtures : []);
}

/** De-duplicated, capped list that the carousel rotates through. */
export function featuredFixtures(pool) {
  const list = Array.isArray(pool) ? pool : [];
  return list.filter((f, i) => f?.id && list.findIndex(g => g?.id === f.id) === i).slice(0, FEATURED_LIMIT);
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
