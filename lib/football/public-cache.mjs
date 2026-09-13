// Cache only explicitly public, unauthenticated GET responses. Query parameters
// remain part of the key, including the visitor's requested dates/timezone.
const recent = new Map();
/**
 * @param {Request} request
 * @param {() => Promise<unknown>} load
 * @param {Cache | null} cache
 */
export async function publicResponse(request, load, cache = null) {
  const eligible = cache && request.method === 'GET' && !request.headers.has('authorization') &&
    !/no-cache|no-store/i.test(request.headers.get('cache-control') ?? '');
  const key = eligible ? new Request(request.url, { method: 'GET' }) : null;
  if (key) {
    const local = recent.get(key.url);
    if (local?.expires > Date.now()) return new Response(local.body, {headers: local.headers});
    recent.delete(key.url);
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const response = Response.json(await load(), { headers: {
    'Cache-Control': eligible ? 'public, max-age=0, s-maxage=60' : 'no-store',
  } });
  if (key) {
    // A bounded isolate cache also helps on workers.dev, where edge cache
    // availability varies. Never rely on either cache for durable data.
    const body = await response.clone().text();
    if (new TextEncoder().encode(body).length <= 512000) {
      if (recent.size >= 16) recent.delete(recent.keys().next().value);
      recent.set(key.url, {body, headers: [...response.headers], expires: Date.now()+60000});
    }
    try { await cache.put(key, response.clone()); }
    catch { console.warn('public_cache_unavailable'); }
  }
  return response;
}
