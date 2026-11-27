// Source verification for researched claims. A URL appearing in the search results is NOT proof: each claim is
// checked against the text of the page it cites. Only URLs that this response's own web search returned are fetched
// (never a URL the model merely wrote), over HTTPS, honouring robots.txt, with a short timeout and a size cap.
// Nothing from the page is stored except the verdict (and the page's publication time when it states one).
// Verdicts: verified | not_on_page (player/team/status not stated together) | wrong_fixture | outdated |
// unreachable (blocked, error, not HTML) | robots (disallowed). Only 'verified' claims are kept.
const UA = 'MnembaSourceCheck/1.0 (fact verification; content not stored)';
const MAX_BYTES = 1_500_000, TIMEOUT_MS = 8000;

export const fold = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\p{M}]/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
const GENERIC = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'club', 'united', 'city', 'real', 'sporting', 'athletic', 'atletico', 'football', 'calcio', 'the', 'de', 'la', 'le', 'los', 'del', 'fk', 'sk', 'if', 'bk', 'cd', 'ud', 'sd', 'rc', 'us', 'as', 'ss', 'pfk', 'ik', 'nk']);
/** Distinctive name tokens of a team (e.g. "Neftchi Baku" -> neftchi, baku; "Real Madrid" -> madrid). */
export const teamTokens = name => fold(name).split(' ').filter(t => t.length >= 4 && !GENERIC.has(t));

const STATUS_WORDS = {
  injured: /injur|knock|strain|sprain|fractur|surgery|hamstring|ankle|knee|groin|calf|muscle|sidelined|ruled out|will miss|misses|out for|absent|layoff|recover/,
  unavailable: /out\b|ruled out|will miss|misses|unavailable|absent|not available|sidelined|personal reasons|international duty|not in the squad|left out/,
  suspended: /suspen|ban\b|banned|red card|accumulat|yellow cards/,
  doubtful: /doubt|questionable|game time decision|late fitness test|fitness test|uncertain|day to day|probable|race against time|50 50/,
  available_again: /return|back in training|available again|fit again|recovered|back from|cleared|available for selection/,
};
const NONE_WORDS = /no (new |fresh )?injur|fully fit|clean bill of health|no absentees|full squad|no suspensions|no injury concerns|injury free|everyone is available|no players (are )?(injured|missing)/;

/** Text of an HTML page (scripts, styles and tags removed) plus a stated publication time, if any. */
export function pageText(html) {
  const pub = html.match(/(?:article:published_time|datePublished|dateModified|og:updated_time)["']?\s*(?:content=|:)\s*["']([^"']{8,40})["']/i)?.[1] ?? html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&apos;/g, "'");
  const ms = Date.parse(pub ?? ''); return {text: fold(text), publishedAt: Number.isFinite(ms) ? ms : null};
}

/** robots.txt check: rules of our own group if present, else the '*' group; longest match wins (Allow on ties).
 * A missing or unreadable robots.txt allows. */
export function robotsAllows(robots, path) {
  if (!robots) return true;
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of robots.split(String.fromCharCode(10))) {
    const line = raw.replace(/#.*/, '').trim(); if (!line || !line.includes(':')) continue;
    const key = line.slice(0, line.indexOf(':')).trim().toLowerCase(), v = line.slice(line.indexOf(':') + 1).trim();
    if (key === 'user-agent') { if (!lastWasAgent) { cur = {agents: [], allow: [], disallow: []}; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (key === 'allow' || key === 'disallow') && v) cur[key].push(v);
  }
  const g = groups.find(x => x.agents.some(a => a.startsWith('mnembasourcecheck'))) ?? groups.find(x => x.agents.includes('*'));
  if (!g) return true;
  const len = rules => rules.filter(r => ruleMatches(r, path)).reduce((m, r) => Math.max(m, r.length), -1);
  return len(g.allow) >= len(g.disallow);
}

/**
 * RFC 9309 path matching: '*' matches any sequence, a trailing '$' anchors the end, otherwise a prefix match.
 * (Production fault fixed: "Disallow: /*.php$" was cut at '*' into "Disallow: /", blocking whole sites.)
 */
export function ruleMatches(rule, path) {
  const anchored = rule.endsWith('$'), parts = (anchored ? rule.slice(0, -1) : rule).split('*');
  if (!path.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (anchored && i === parts.length - 1) return path.length - part.length >= pos && path.endsWith(part);
    const at = path.indexOf(part, pos); if (at < 0) return false; pos = at + part.length;
  }
  return anchored ? pos === path.length : true;
}

async function readCapped(res) {
  if (!res.body?.getReader) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader(), chunks = []; let size = 0;
  for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; chunks.push(value); if (size >= MAX_BYTES) { await reader.cancel().catch(() => {}); break; } }
  return new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

/** Per-request page loader with caches (one fetch per URL and one robots.txt per host). */
export function pageLoader(fetcher, {deadline = Infinity, now = Date.now} = {}) {
  const pages = new Map(), robots = new Map(); let fetches = 0;
  const get = async (url, accept) => {
    const signal = AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_MS, deadline - now())));
    return fetcher(url, {headers: {'user-agent': UA, accept}, redirect: 'follow', signal});
  };
  async function load(raw) {
    if (pages.has(raw)) return pages.get(raw);
    const p = (async () => {
      let url; try { url = new URL(raw); } catch { return {verdict: 'unreachable', reason: 'invalid URL'}; }
      if (url.protocol !== 'https:' || url.username || url.password) return {verdict: 'unreachable', reason: 'not plain HTTPS'};
      if (now() > deadline - 2000) return {verdict: 'unreachable', reason: 'run deadline'};
      if (!robots.has(url.host)) robots.set(url.host, get(`https://${url.host}/robots.txt`, 'text/plain').then(r => r.ok ? r.text() : null).catch(() => null));
      if (!robotsAllows(await robots.get(url.host), url.pathname + url.search)) return {verdict: 'robots', reason: 'robots.txt disallows'};
      try {
        fetches++; const res = await get(url.href, 'text/html,application/xhtml+xml');
        if (!res.ok) return {verdict: 'unreachable', reason: `HTTP ${res.status}`};
        if (!/html|xml|text\/plain/i.test(res.headers.get('content-type') ?? 'text/html')) return {verdict: 'unreachable', reason: 'not a web page'};
        return {verdict: 'loaded', ...pageText(await readCapped(res))};
      } catch (e) { return {verdict: 'unreachable', reason: String(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message).slice(0, 60)}; }
    })();
    pages.set(raw, p); return p;
  }
  return {load, stats: () => ({pages: pages.size, fetches})};
}

const near = (text, a, words, span = 400) => { let i = text.indexOf(a); while (i >= 0) { const w = text.slice(Math.max(0, i - span), i + a.length + span); if (words.test(w)) return true; i = text.indexOf(a, i + 1); } return false; };
const surname = player => { const t = fold(player).split(' ').filter(x => x.length >= 3); return t[t.length - 1] ?? fold(player); };

/**
 * Check one claim against its page. claim: {kind: 'availability'|'none'|'lineup', player?, status?, team, opponent,
 * startsAt, starters?}. Returns {verdict, publishedAt, reason}.
 */
export function checkClaim(page, claim) {
  if (page.verdict !== 'loaded') return {verdict: page.verdict, reason: page.reason};
  const t = page.text, team = teamTokens(claim.team), opp = teamTokens(claim.opponent);
  if (page.publishedAt && page.publishedAt < claim.startsAt - 10 * 864e5) return {verdict: 'outdated', reason: 'page published more than 10 days before the start', publishedAt: page.publishedAt};
  if (team.length && !team.some(x => t.includes(x))) return {verdict: 'not_on_page', reason: 'team not named on the page'};
  const fixtureOk = (opp.length && opp.some(x => t.includes(x))) || (page.publishedAt && page.publishedAt >= claim.startsAt - 4 * 864e5);
  if (!fixtureOk) return {verdict: 'wrong_fixture', reason: 'page names neither the opponent nor a date close to this match'};
  if (claim.kind === 'context') return {verdict: 'verified', publishedAt: page.publishedAt};
  if (claim.kind === 'none') return NONE_WORDS.test(t) ? {verdict: 'verified', publishedAt: page.publishedAt} : {verdict: 'not_on_page', reason: 'page does not state that no players are missing'};
  if (claim.kind === 'lineup') {
    const names = (claim.starters ?? []).map(p => surname(p.name)), found = names.filter(n => n && t.includes(n)).length, need = Math.ceil(names.length * 0.8);
    return found >= need ? {verdict: 'verified', publishedAt: page.publishedAt} : {verdict: 'not_on_page', reason: `${found} of ${names.length} starters named on the page`};
  }
  const sn = surname(claim.player), full = fold(claim.player);
  if (!t.includes(sn)) return {verdict: 'not_on_page', reason: 'player not named on the page'};
  const words = STATUS_WORDS[claim.status] ?? STATUS_WORDS.unavailable;
  return near(t, t.includes(full) ? full : sn, words) ? {verdict: 'verified', publishedAt: page.publishedAt} : {verdict: 'not_on_page', reason: `page does not state ${claim.status} near the player's name`};
}
