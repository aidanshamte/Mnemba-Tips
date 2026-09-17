import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, postgresDatabase, translateSQL } from '../../lib/azure/postgres.mjs';
import { Store } from '../../lib/football/store.mjs';
import { IntelligenceService } from '../../lib/football/intelligence.mjs';
import { runScheduled, CRON_JOBS } from '../../lib/football/scheduled.mjs';

test('SQL placeholders leave literal question marks and escaped quotes intact', () => {
  assert.equal(translateSQL("SELECT '?' q, 'it''s?' value WHERE id=?"), "SELECT '?' q, 'it''s?' value WHERE id=$1");
  assert.match(translateSQL("SELECT json_extract(payload,'$.home.name') name FROM fixtures WHERE id=?"), /payload::jsonb #>> '\{home,name\}'/);
});

test('PostgreSQL migrated data, public reads, immutable history, transactions and scheduler', { skip: !process.env.DATABASE_URL }, async () => {
  const pool = createPool(), db = postgresDatabase(pool), store = new Store(db);
  try {
    store.readOnly = true;
    const service = new IntelligenceService(store, { MNEMBA_SCHEMA_MANAGED: '1' });
    for (const query of ['view=overview','view=catalog','view=news','view=fixtures&q=Arsenal','view=global-search&kind=team&q=Barcelona','view=global-search&kind=player&q=Messi','view=prediction-history','view=matchday','view=shortlists','view=markets']) {
      const value = await service.read(new URLSearchParams(query));
      assert.ok(value, query);
    }
    const fixture = await store.one('SELECT id FROM fixtures ORDER BY starts_at DESC LIMIT 1');
    assert.ok(await service.read(new URLSearchParams({ view: 'match-context', id: fixture.id })));
    const row = await store.one('SELECT id FROM prematch_snapshots LIMIT 1');
    if (row) await assert.rejects(db.prepare('UPDATE prematch_snapshots SET status=status WHERE id=?').bind(row.id).run(), /Immutable/);
    await assert.rejects(db.batch([db.prepare("INSERT INTO sync_locks VALUES('azure-test-rollback','test',0)"),db.prepare('SELECT missing_column FROM sync_locks') ]));
    assert.equal(await db.prepare("SELECT id FROM sync_locks WHERE id='azure-test-rollback'").first(), null);
    const owners = await Promise.all(Array.from({length:5},()=>new Store(db).lock('azure-test-lock', 60000)));
    assert.equal(owners.filter(Boolean).length, 1);
    await new Store(db).unlock('azure-test-lock', owners.find(Boolean));
    const quotaStore = new Store(db, () => Date.UTC(2099, 0, 1));
    const categories = ['live','fixtures','details','statistics','retry'];
    try {
      await Promise.allSettled(categories.flatMap(category => Array.from({length:55},()=>quotaStore.reserve(category))));
      const budget = await quotaStore.budget();
      assert.equal(budget.used, 96, 'Concurrent reservations must respect total daily automatic allowance');
      await assert.rejects(quotaStore.reserve('live'), /allocation exhausted/);
    } finally {
      await db.prepare('DELETE FROM api_request_usage WHERE day=?').bind('2099-01-01').run();
    }
    // Provider calls are stubbed; the real scheduler writes and leases use PostgreSQL.
    for (const cron of Object.keys(CRON_JOBS)) {
      const scheduledTime = Date.now();
      const options = { service: { async initialize() {}, async sync() { return { outcome: 'success' }; } } };
      const result = await runScheduled({ cron, scheduledTime }, { DB: db }, options);
      assert.equal(result.state, 'success');
      assert.equal((await runScheduled({ cron, scheduledTime }, { DB: db }, options)).state, 'skipped');
      await db.prepare('DELETE FROM cron_runs WHERE id=?').bind(`${cron}:${scheduledTime}`).run();
    }
  } finally { await pool.end(); }
});
