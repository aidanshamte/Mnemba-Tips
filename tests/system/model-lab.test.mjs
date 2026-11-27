import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {database,apiFixture} from '../football-db.mjs';import {normalizeFixture} from '../../lib/football/providers.mjs';import {IntelligenceService} from '../../lib/football/intelligence.mjs';import {ModelLab} from '../../lib/football/model-lab.mjs';import {forecastMigration} from '../../lib/football/schema-v4.mjs';
test('forecast migration matches source and rejects mutation or post-kickoff creation',async()=>{const {store,sqlite}=database();try{await store.init();await store.init();assert.equal(readFileSync(new URL('../../drizzle/0004_football_forecasts.sql',import.meta.url),'utf8'),forecastMigration.join(';\n')+';\n');const service=new IntelligenceService(store);await service.initialize();const f=normalizeFixture('api-football',apiFixture(940));await service.saveFixtures([f]);await assert.rejects(store.run('INSERT INTO analysis_forecasts VALUES(?,?,?,?,?,?,?,?,?)','bad',f.id,'test',2,1,2,0,'{}','[]'));}finally{sqlite.close();}});
test('prospective models persist immutable forecasts, grade after results and abstain on date-only kickoff',async()=>{const {store,sqlite}=database();let now=Date.parse('2026-09-10T12:00:00Z');store.now=()=>now;try{await store.init();const service=new IntelligenceService(store);await service.initialize();const fixtures=[1,2,3,4].map(i=>normalizeFixture('api-football',apiFixture(950+i,'FT',`2026-09-0${i}T12:00:00Z`)));await service.saveFixtures(fixtures);const f=normalizeFixture('api-football',apiFixture(960,'NS','2026-09-11T12:00:00Z'));await service.saveFixtures([f]);const lab=new ModelLab(service);assert.equal((await lab.capture({...f,kickoffPrecision:'date'})).state,'abstained');assert.equal((await lab.capture(f)).forecasts,2);assert.equal((await lab.capture(f)).state,'cached');await assert.rejects(store.run("UPDATE analysis_forecasts SET payload='{}'"),/immutable/);assert.equal((await lab.performance()).versions[0].count,0);now=Date.parse('2026-09-11T15:00:00Z');await service.saveFixtures([normalizeFixture('api-football',apiFixture(960,'FT','2026-09-11T12:00:00Z'))]);assert.equal(await lab.grade(),0);assert.equal((await lab.performance()).versions[0].count,1);assert.equal((await lab.capture(f)).state,'abstained');}finally{sqlite.close();}});

test('forecast evidence is a constant-size fingerprint of the claim set, not the full id list (storage incident 2026-11-27)', async () => {
  const {store, sqlite} = database(); let now = Date.parse('2026-09-20T12:00:00Z'); store.now = () => now;
  try {
    await store.init(); const service = new IntelligenceService(store); await service.initialize();
    await service.saveFixtures(Array.from({length: 40}, (_, i) => normalizeFixture('api-football', apiFixture(1200 + i, 'FT', `2026-09-${String(1 + (i % 18)).padStart(2, '0')}T12:00:00Z`))));
    const f = normalizeFixture('api-football', apiFixture(1300, 'NS', '2026-09-21T12:00:00Z')); await service.saveFixtures([f]);
    assert.equal((await new ModelLab(service).capture(f)).forecasts, 2);
    const rows = await store.all('SELECT evidence_ids FROM analysis_forecasts WHERE fixture_id=?', f.id);
    for (const r of rows) {
      const e = JSON.parse(r.evidence_ids);
      assert.equal(e.format, 'claim-set-sha256-v1'); assert.ok(e.count > 10, `the used claims are counted (${e.count})`); assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.ok(e.fixtureClaim);
      assert.ok(r.evidence_ids.length < 300, `evidence stays small (${r.evidence_ids.length} bytes)`);
    }
  } finally { sqlite.close(); }
});
