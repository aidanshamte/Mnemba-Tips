// Featured-league ordering (presentation only). Favourites (device-local) come first, then the editorial featured list,
// then the regional list, then every other league in its original order. Nothing is filtered out.
import config from '../../config/featured-competitions.json' with {type: 'json'};
export const FEATURED_COMPETITIONS = Object.freeze([...config.featured]);
export const REGIONAL_COMPETITIONS = Object.freeze([...config.regional]);
const order = new Map([...config.featured, ...config.regional].map((id, i) => [id, i]));

export const isFeatured = id => FEATURED_COMPETITIONS.includes(id);
/** Sort key: [tier, position]; tier 0 favourite, 1 featured, 2 regional, 3 other. */
export function competitionRank(id, favourites = []) {
  const fav = favourites.indexOf(id);
  if (fav >= 0) return [0, fav];
  if (order.has(id)) return [order.get(id) < config.featured.length ? 1 : 2, order.get(id)];
  return [3, 0];
}
/** Stable ordering of items by their competition id; ties keep the original order. */
export function orderByCompetition(items, idOf, favourites = []) {
  return items.map((item, i) => ({item, i, r: competitionRank(idOf(item), favourites)}))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i).map(x => x.item);
}
