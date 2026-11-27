// The news view's freshness marker must follow the scheduled news sync (production showed "stale" from
// 2026-09-11 although the three-hourly job had just stored 133 current stories).
import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';

test('a successful scheduled news sync refreshes the public freshness marker', async () => {
  const {store, sqlite} = database();
  try {
    await store.init(); let now = Date.parse('2026-11-20T19:43:00Z'); store.now = () => now;
    const service = new IntelligenceService(store); await service.initialize();
    await store.putCache('job:news', {status: 'success', result: {outcome: 'success'}}, 1);
    now += 60000;
    service.news = async () => ({sources: [{source: 'bbc', articles: 91, state: 'success'}, {source: 'guardian', articles: 58, state: 'success'}]});
    await service.sync('news');
    const view = await service.read(new URLSearchParams({view: 'news'}));
    assert.equal(view.freshness.stale, false);
    assert.equal(view.freshness.updatedAt, now);
    now += 5 * 3600000;
    assert.equal((await service.read(new URLSearchParams({view: 'news'}))).freshness.stale, true, 'stale again when no run arrives within the cadence');
  } finally { sqlite.close(); }
});

test('the news view honours a limit so the home page fetches only the stories it shows', async () => {
  const {store, sqlite} = database();
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    for (let i = 0; i < 9; i++) { const a = {id: `news:l-${i}`, url: `https://example.org/story-${i}`, headline: `Distinct headline number ${i} about club ${i}`, summary: 'Summary.', publisher: 'Example', publishedAt: Date.parse('2026-11-20T09:00:00Z') + i * 60000, category: 'news'};
      await store.upsert('news_articles', {id: a.id, canonical_url: a.url, headline: a.headline, publisher: a.publisher, published_at: a.publishedAt, category: a.category, payload: JSON.stringify(a), updated_at: a.publishedAt}); }
    assert.equal((await service.read(new URLSearchParams({view: 'news', limit: '6'}))).articles.length, 6);
    assert.equal((await service.read(new URLSearchParams({view: 'news'}))).articles.length, 9, 'no limit: unchanged behaviour');
    assert.equal((await service.read(new URLSearchParams({view: 'news', limit: 'x'}))).articles.length, 9, 'an invalid limit is ignored');
  } finally { sqlite.close(); }
});
