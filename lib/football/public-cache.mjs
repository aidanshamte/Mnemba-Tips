// Cache only explicitly public, unauthenticated GET responses. Query parameters
// remain part of the key, including the visitor's requested dates/timezone.
const recent = new Map(), inflight = new Map(), LOCAL_MAX = 64, LOCAL_BYTES = 512000;
/**
 * @param {Request} request
 * @param {() => Promise<unknown>} load
 * @param {Cache | null} cache shared edge cache when the platform has one
 * @param {number} maxAge seconds
 * @param {boolean} publicView the view is public: allows the bounded in-process cache even without an edge cache
 *   (Azure has none; every match page otherwise repeated the full read).
 */
export async function publicResponse(request, load, cache = null, maxAge = 60, publicView = false) {
  const eligible = (cache || publicView) && request.method === 'GET' && !request.headers.has('authorization') &&
    !/no-cache|no-store/i.test(request.headers.get('cache-control') ?? '');
  const url = eligible ? new URL(request.url).toString() : null;
  if (url) {
    const local = recent.get(url);
    if (local?.expires > Date.now()) return new Response(local.body, {headers: local.headers});
    recent.delete(url);
    if (cache) { const hit = await cache.match(new Request(url, {method: 'GET'})); if (hit) return hit; }
    // Identical concurrent requests share one read instead of each holding a database connection.
    const pending = inflight.get(url);
    if (pending) { const shared = await pending; return new Response(shared.body, {headers: shared.headers}); }
  }
  const produce = async () => {
    const response = Response.json(await load(), {headers: {'Cache-Control': eligible ? `public, max-age=0, s-maxage=${maxAge}` : 'no-store'}});
    return {response, body: url ? await response.clone().text() : null, headers: [...response.headers]};
  };
  if (!url) return (await produce()).response;
  const job = produce(); inflight.set(url, job);
  try {
    const {response, body, headers} = await job;
    if (new TextEncoder().encode(body).length <= LOCAL_BYTES) {
      if (recent.size >= LOCAL_MAX) recent.delete(recent.keys().next().value);
      recent.set(url, {body, headers, expires: Date.now() + maxAge * 1000});
    }
    if (cache) { try { await cache.put(new Request(url, {method: 'GET'}), response.clone()); } catch { console.warn('public_cache_unavailable'); } }
    return response;
  } finally { inflight.delete(url); }
}
