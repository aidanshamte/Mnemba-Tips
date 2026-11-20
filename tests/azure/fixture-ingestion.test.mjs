import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {ingestFixtureBatch,recordIngestionHealth} from '../../lib/football/fixture-ingestion.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {apiFixture} from '../football-db.mjs';

test('isolated PostgreSQL fixture union, counters, unchanged refresh and degraded health', {skip:!process.env.DATABASE_URL},async()=>{
 const pool=createPool(),schema=`ingestion_check_${process.pid}`,client=await pool.connect();
 try{
  await client.query(`CREATE SCHEMA ${schema}`);
  const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'")).rows;
  for(const {table_name} of tables){assert.match(table_name,/^[a-z_]+$/);await client.query(`CREATE TABLE ${schema}.${table_name} (LIKE ${table_name} INCLUDING ALL)`);}
  await client.query(`SET search_path=${schema},public`);
  const store=new Store(postgresDatabase({query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})}),()=>Date.parse('2026-09-24T10:00:00Z'));
  const service=new IntelligenceService(store);await service.initialize();
  const fixtures=[1,2].map(id=>normalizeFixture('api-football',apiFixture(id,'NS','2026-09-24T16:00:00Z',id*10,id*10+1)));
  const load=counts=>{counts.raw=fixtures.length;return fixtures;};
  const first=await ingestFixtureBatch(service,'api-football',{},load);assert.equal(first.inserted,2);assert.equal(first.persisted,2);
  const second=await ingestFixtureBatch(service,'api-football',{},load);assert.equal(second.unchanged,2);assert.equal(second.inserted,0);
  const report=await recordIngestionHealth(store,'fixtures',[second]);assert.equal(report.inventory.current,2);assert.equal(report.inventory.future,2);assert.equal(report.state,'degraded');
  assert.equal((await service.read(new URLSearchParams({view:'matchday',day:'today',timezone:'UTC'}))).count,2);
 }finally{await client.query('RESET search_path');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();}
});
