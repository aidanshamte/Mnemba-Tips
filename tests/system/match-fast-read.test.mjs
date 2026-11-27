// Production 2026-11-27: every match page returned 503 after ~70-80 s. The roster query scanned all field_claims
// (no index on `field`) past the 60 s statement timeout, after season and history reads. Opening a match is now an
// essential bounded read first, with the detailed context loaded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {publicResponse} from '../../lib/football/public-cache.mjs';
import {publicViews} from '../../lib/football/access.mjs';

async function world() {
  const db = database(); db.store.now = () => Date.parse('2026-09-10T12:00:00Z'); await db.store.init();
  const service = new IntelligenceService(db.store, {}); await service.initialize();
  const done = [1, 2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(4100 + i, 'FT', `2026-09-0${i}T12:00:00Z`)));
  const f = normalizeFixture('api-football', apiFixture(4200, 'NS', '2026-09-11T12:00:00Z'));
  await service.saveFixtures([...done, f]); return {...db, service, f};
}

test('essential match read: stored fixture, freshness, estimate and recommendation; no heavy sections; public', async () => {
  const w = await world();
  try {
    w.store.readOnly = true; const seen = [];
    const orig = w.store.all.bind(w.store); w.store.all = (sql, ...a) => { seen.push(sql); return orig(sql, ...a); };
    const e = await w.service.read(new URLSearchParams({view: 'match', id: w.f.id}));
    assert.equal(e.essential, true); assert.equal(e.fixture.id, w.f.id); assert.ok(e.updatedAt > 0); assert.ok(e.analysis); assert.ok('recommendation' in e);
    for (const k of ['rosters', 'table', 'form', 'details', 'news', 'sources']) assert.equal(k in e, false, `${k} is loaded separately`);
    for (const k of ['archive', 'distribution', 'markets']) assert.equal(k in e.analysis, false, `analysis.${k} is a Details payload`);
    assert.equal(seen.some(q => /field_claims|season_id/.test(q)), false, 'no claim-history or season scans on the essential path');
    assert.deepEqual(await w.service.read(new URLSearchParams({view: 'match', id: 'api-football:missing'})), {unavailable: true});
    assert.ok(publicViews.has('match'));
  } finally { w.sqlite.close(); }
});

test('detailed context uses the indexed roster and competition-season reads', async () => {
  const w = await world();
  try {
    const seen = []; const orig = w.store.all.bind(w.store); w.store.all = (sql, ...a) => { seen.push(sql); return orig(sql, ...a); };
    const c = await w.service.read(new URLSearchParams({view: 'match-context', id: w.f.id}));
    assert.equal(c.rosters.length, 2);
    assert.equal(seen.some(q => /team_id=\? OR p\.id IN/.test(q)), false, 'no OR roster query that scans every claim');
    assert.ok(seen.some(q => /competition_id=\? AND season_id=\?/.test(q)));
    const plan = w.sqlite.prepare("EXPLAIN QUERY PLAN SELECT entity_id FROM field_claims WHERE field=? AND valid_to IS NULL AND expires_at>?").all('membership:x', 0);
    assert.match(JSON.stringify(plan), /idx_claims_open_field/, 'membership lookup uses the read-path index');
  } finally { w.sqlite.close(); }
});

test('public in-process cache: identical concurrent requests share one read; authorised requests are never cached', async () => {
  let n = 0; const load = async () => { n++; await new Promise(r => setTimeout(r, 20)); return {n}; };
  const url = 'https://example.test/api/intelligence?view=match&id=dedupe-' + Date.now();
  const rs = await Promise.all([1, 2, 3].map(() => publicResponse(new Request(url), load, null, 15, true)));
  assert.equal(n, 1); for (const r of rs) assert.equal((await r.json()).n, 1);
  await publicResponse(new Request(url), load, null, 15, true); assert.equal(n, 1, 'served from the bounded cache');
  await publicResponse(new Request(url, {headers: {authorization: 'Bearer x'}}), load, null, 15, true); assert.equal(n, 2, 'user-specific request bypasses the shared cache');
  await publicResponse(new Request(url + '&x=1'), load, null, 15, false); assert.equal(n, 3, 'non-public views are not cached');
});
