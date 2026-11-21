// Production 2026-11-21: every fixtures/match request read the whole fixture_identities (50k rows) and entity_aliases
// (8k rows) tables. Under parallel requests the web pool (5 connections) was exhausted, the health check's own query
// timed out, readiness probes failed and the container exited. Request paths must read only the rows they need.
import test from 'node:test';
import assert from 'node:assert/strict';
import {database, apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';

test('history and fixture de-duplication read only the identities and aliases they need', async () => {
  const {store, sqlite} = database(); store.now = () => Date.parse('2026-11-01T12:00:00Z');
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    const past = [1, 2, 3, 4].map(i => normalizeFixture('api-football', apiFixture(7000 + i, 'FT', `2026-10-0${i}T12:00:00Z`)));
    const other = normalizeFixture('api-football', apiFixture(7100, 'FT', '2026-10-05T12:00:00Z', 30, 40));
    await service.saveFixtures([...past, other]);
    const seen = [], all = store.all.bind(store);
    store.all = (sql, ...args) => { seen.push(String(sql).replace(/\s+/g, ' ').trim()); return all(sql, ...args); };
    const history = await service.history('api-football:10', 'api-football:20');
    assert.equal(history.length, 4, 'history unchanged');
    const listed = await service.deduplicateFixtures(past);
    assert.equal(listed.length, 4); assert.ok(listed.every(f => f.canonicalId));
    for (const sql of seen) {
      assert.ok(!/^SELECT fixture_id,canonical_id FROM fixture_identities$/i.test(sql), `full fixture_identities read: ${sql}`);
      assert.ok(!/^SELECT provider_id,canonical_id FROM entity_aliases$/i.test(sql), `full entity_aliases read: ${sql}`);
    }
  } finally { sqlite.close(); }
});
