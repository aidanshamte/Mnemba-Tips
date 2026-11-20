// Release gate for one Azure revision (direct label URL) or the public domain.
//   node scripts/azure/verify-revision.mjs https://mnemba-web---candidate.<env>.azurecontainerapps.io [evidence.json]
// Checks 27 public routes and assets, health/database, the approved logo, security headers,
// protected administrative endpoints, absence of secrets in responses, and response latency.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const url = new URL(process.argv[2] ?? '');
if (!(url.protocol === 'https:' && (url.hostname.endsWith('.azurecontainerapps.io') || url.hostname === 'aidanshamte.me' || url.hostname === 'www.aidanshamte.me')) && !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Use an Azure-generated or canonical-domain HTTPS URL, or a loopback URL');
const origin = url.origin, evidence = {origin, checkedAt: new Date().toISOString(), routes: [], failures: [], warnings: []};
// Patterns that must never appear in a public response body.
const SECRET = [/postgres(ql)?:\/\/[^\s"']*:[^\s"'@]*@/i, /DATABASE_URL\s*[=:]/, /MNEMBA_INTERNAL_TOKEN/, /AccountKey=/i, /[?&]sig=[A-Za-z0-9%+/=]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}/];

async function get(path, {status = 200, type, method = 'GET', body, headers} = {}) {
  const started = performance.now();
  const r = await fetch(origin + path, {method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(90000)});
  const ms = Math.round(performance.now() - started), ct = r.headers.get('content-type') ?? '';
  const text = /json|text|html|javascript|xml|manifest/.test(ct) ? await r.text() : (await r.arrayBuffer(), '');
  const row = {path, method, status: r.status, ms, type: ct.split(';')[0], bytes: Number(r.headers.get('content-length') ?? text.length)};
  evidence.routes.push(row);
  try {
    assert.equal(r.status, status, `${method} ${path} status`);
    if (type) assert.match(ct, type, `${path} content-type`);
    for (const p of SECRET) assert.ok(!p.test(text), `${path} exposes a secret-like value (${p})`);
  } catch (e) { evidence.failures.push(e.message); }
  return {r, text};
}

// 1. Health and database connectivity.
const health = JSON.parse((await get('/api/health', {type: /json/})).text || '{}');
if (health.database !== 'ready') evidence.failures.push(`database not ready: ${health.database}`);
evidence.health = {status: health.status, database: health.database, mode: health.mode};

// 2. Real stored entities for dynamic routes.
const api = async q => JSON.parse((await get('/api/intelligence?' + q, {type: /json/})).text || '{}');
const QUERIES = {team: ['Arsenal', 'Bayern', 'FC'], player: ['Messi', 'Kane', 'Saka', 'Putellas', 'Bronze'], competition: ['Premier League', 'Bundesliga', 'Liga']};
async function search(kind) { for (const q of QUERIES[kind]) { const hit = (await api(`view=global-search&kind=${kind}&q=${encodeURIComponent(q)}`)).results?.find(r => r.kind === kind); if (hit?.url) return hit.url; } return null; }
const [team, player, competition, news, fixtures] = await Promise.all([search('team'), search('player'), search('competition'), api('view=news'), api('view=fixtures')]);
const fixtureId = (fixtures.fixtures ?? [])[0]?.id, newsId = news.articles?.[0]?.id;
const token = id => 'id-' + Array.from(new TextEncoder().encode(id), b => b.toString(16).padStart(2, '0')).join('');

// 3. The 27 public routes and assets.
const html = {type: /html/};
const routes = [
  ['/', html], ['/football', html], ['/football?tab=Fixtures', html], ['/football?tab=Leagues', html], ['/football?tab=News', html],
  ['/football/search?kind=team&q=Arsenal', html], ['/football/predictions', html], ['/football/shortlists', html], ['/football/markets', html],
  ['/football/coverage', html], ['/football/visual-credits', html], ['/football/players', html], ['/basketball', html],
  ['/lab', {status: 307}], ['/football/admin', {status: 307}],
  [fixtureId ? `/football/match/${encodeURIComponent(fixtureId)}` : null, html, 'stored fixture'], [team, html, 'stored team'], [player, html, 'stored player'], [competition, html, 'stored competition'],
  [newsId ? `/football/news/${token(newsId)}` : null, html, 'stored news story', 'optional'],
  ['/this-route-does-not-exist', {status: 404, type: /html/}],
  ['/manifest.webmanifest', {type: /manifest|json/}], ['/favicon.ico', {type: /icon/}],
  ['/brand/mnemba-tips-wordmark-480.avif', {type: /avif/}], ['/brand/mnemba-tips-wordmark-480.png', {type: /png/}],
  ['/brand/icon-512.png', {type: /png/}], ['/brand/mnemba-tips-social-1200x630.png', {type: /png/}],
];
let checked = 0;
for (const [path, opts, entity, optional] of routes) {
  // A healthy but empty news view is a data gap (warning); any other missing stored entity is a failure.
  if (!path) { (optional ? evidence.warnings : evidence.failures).push(`No ${entity} returned by the API; its route was not exercised.`); continue; }
  await get(path, opts); checked++;
}
evidence.routeCount = checked;
// The lab and admin redirects must land on the public football page.
for (const path of ['/lab', '/football/admin']) { const r = await fetch(origin + path, {redirect: 'manual'}); if (!/\/football$/.test(r.headers.get('location') ?? '')) evidence.failures.push(`${path} redirects to ${r.headers.get('location')}`); }

// 4. Approved logo is referenced by the page, metadata and manifest.
const page = (await get('/football', html)).text;
for (const needle of ['/brand/mnemba-tips-wordmark-', 'og:image', '/brand/mnemba-tips-social-1200x630.png', '/favicon.ico', '/brand/apple-touch-icon.png'])
  if (!page.includes(needle)) evidence.failures.push(`/football missing ${needle}`);
const manifest = JSON.parse((await get('/manifest.webmanifest')).text || '{}');
if (!(manifest.icons ?? []).some(i => i.src === '/brand/icon-512.png')) evidence.failures.push('manifest lacks the approved 512px icon');
if (page.includes('/favicon.svg')) evidence.failures.push('page still references the retired favicon.svg');

// 5. Security headers (no regression from the current production set).
const head = await fetch(origin + '/football', {redirect: 'manual'});
const csp = head.headers.get('content-security-policy') ?? '';
evidence.headers = {csp: !!csp, objectSrcNone: csp.includes("object-src 'none'"), baseUriSelf: csp.includes("base-uri 'self'"),
  hsts: head.headers.get('strict-transport-security'), nosniff: head.headers.get('x-content-type-options'), referrer: head.headers.get('referrer-policy')};
if (!evidence.headers.objectSrcNone || !evidence.headers.baseUriSelf) evidence.failures.push('Content-Security-Policy regressed');

// 6. Administrative and internal endpoints stay protected.
for (const api of ['intelligence', 'football']) for (const view of ['sources', 'files', 'diagnostics', 'evidence', 'social', 'performance']) await get(`/api/${api}?view=${view}`, {status: 403});
await get('/api/intelligence', {status: 403, method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({job: 'fixtures'})});
await get('/api/predict', {status: 410, method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"matchupId":"x"}'});

// 7. Latency summary.
const times = evidence.routes.filter(r => r.method === 'GET').map(r => r.ms).sort((a, b) => a - b);
evidence.latency = {p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], max: times.at(-1)};
evidence.passed = evidence.failures.length === 0;
writeFileSync(process.argv[3] ?? 'revision-verification.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({origin, passed: evidence.passed, routes: evidence.routeCount, latency: evidence.latency, health: evidence.health, headers: evidence.headers, warnings: evidence.warnings, failures: evidence.failures}, null, 2));
if (!evidence.passed) process.exit(1);
