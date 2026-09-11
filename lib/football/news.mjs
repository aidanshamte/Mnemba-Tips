export const FEEDS = [
  { id: 'bbc', publisher: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', hosts: ['bbc.co.uk','bbc.com'], documentation: 'https://www.bbc.co.uk/sport/articles/cqllxj2n4kyo' },
  { id: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/football/rss', hosts: ['theguardian.com'], documentation: 'https://www.theguardian.com/help/feeds' },
  { id: 'uefa', publisher: 'UEFA', url: 'https://www.uefa.com/rssfeed/news/rss.xml', hosts: ['uefa.com'], documentation: 'https://www.uefa.com/uefachampionsleague/news/' },
];
export function canonicalUrl(raw, source) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!source.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|CMP$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
export function cleanText(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ' })[name]).replace(/\s+/g,' ').trim();
}
export function categoryFor(text) {
  if (/injur|suspend|doubtful|hamstring/i.test(text)) return 'injuries';
  if (/transfer|signing|signs|loan move/i.test(text)) return 'transfers';
  if (/preview|ahead of|team news/i.test(text)) return 'previews';
  if (/defeat|victory|wins|draw|result|beat /i.test(text)) return 'results';
  return 'general';
}
export function article(raw, source, now = Date.now()) {
  const url = canonicalUrl(raw.url, source), headline = cleanText(raw.headline).slice(0, 300), publishedAt = Date.parse(raw.publishedAt);
  if (!url || !headline || !Number.isFinite(publishedAt) || publishedAt > now + 300000) return null;
  return { id: url, url, headline, summary: cleanText(raw.summary).slice(0, 280), publisher: source.publisher, publishedAt, category: categoryFor(headline), summaryLabel: 'Publisher summary', label: 'Confirmed' };
}
export function parseFeed(xml, source, now = Date.now()) {
  if (xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<(rss|feed)[\s>]/i.test(xml)) throw new Error('Invalid or unsafe RSS feed');
  const tag = (block, name) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '';
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 100).map(([, , block]) => article({
    headline: tag(block, 'title'), url: cleanText(tag(block, 'link')) || block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1],
    summary: tag(block, 'description') || tag(block, 'summary'), publishedAt: cleanText(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')),
  }, source, now)).filter(Boolean);
}
function words(text) { return new Set(text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]+/gu) ?? []); }
export function similar(a, b) { const left = words(a), right = words(b); const union = new Set([...left,...right]); return union.size ? [...left].filter(w => right.has(w)).length / union.size >= 0.85 : false; }
export function deduplicate(articles) {
  const output = [];
  for (const item of [...articles].sort((a,b) => b.publishedAt - a.publishedAt)) if (!output.some(other => other.url === item.url || (Math.abs(other.publishedAt-item.publishedAt) < 172800000 && similar(other.headline,item.headline)))) output.push(item);
  return output;
}
export async function syncNews(store, { fetcher = fetch, newsKey = '', development = false } = {}) {
  const fetched = [], statuses = [];
  for (const source of FEEDS) {
    try {
      const response = await fetcher(source.url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseFeed(await response.text(), source, store.now());
      fetched.push(...items); statuses.push({ publisher: source.publisher, status: items.length ? 'Connected' : 'Empty', count: items.length });
    } catch(error) { statuses.push({ publisher: source.publisher, status: 'Unavailable', count: 0, error:error.message }); }
  }
  if (development && newsKey) {
    try {
      const response = await fetcher('https://newsapi.org/v2/everything?q=football&domains=bbc.co.uk,bbc.com,theguardian.com,uefa.com&sortBy=publishedAt&pageSize=30', { headers: { 'X-Api-Key': newsKey }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
      if (!response.ok) throw new Error('NewsAPI unavailable');
      const body = await response.json();
      for (const item of body.articles ?? []) {
        const source = FEEDS.find(s => canonicalUrl(item.url, s));
        if (source && item.source?.name) { const normalized = article({ url: item.url, headline: item.title, summary: item.description, publishedAt: item.publishedAt }, source, store.now()); if (normalized) fetched.push(normalized); }
      }
      statuses.push({ publisher: 'NewsAPI (development metadata)', status: 'Connected' });
    } catch { statuses.push({ publisher: 'NewsAPI (development metadata)', status: 'Unavailable' }); }
  }
  const previous = (await store.all('SELECT payload FROM news_articles ORDER BY published_at DESC LIMIT 1000')).map(r => JSON.parse(r.payload));
  for (const item of deduplicate([...previous, ...fetched])) await store.upsert('news_articles', { id: item.id, canonical_url: item.url, headline: item.headline, publisher: item.publisher, published_at: item.publishedAt, category: item.category, payload: JSON.stringify(item), updated_at: store.now() });
  await store.putCache('news-status', statuses, 10800000);
  return statuses;
}
