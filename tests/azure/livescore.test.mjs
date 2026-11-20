import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {ingestFixtureBatch,recordIngestionHealth} from '../../lib/football/fixture-ingestion.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {apiFixture} from '../football-db.mjs';

import {readFileSync} from 'node:fs';
import {liveTick,liveSnapshot} from '../../lib/football/live.mjs';
test('isolated PostgreSQL real LiveScore discovery, canonical persistence and published state', {skip:!process.env.DATABASE_URL},async()=>{
 const pool=createPool(),schema=`livescore_check_${process.pid}`,client=await pool.connect();
 try{
  await client.query(`CREATE SCHEMA ${schema}`);
  const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'")).rows;
  for(const {table_name} of tables){assert.match(table_name,/^[a-z_]+$/);await client.query(`CREATE TABLE ${schema}.${table_name} (LIKE ${table_name} INCLUDING ALL)`);}
  await client.query(`SET search_path=${schema},public`);
  const store=new Store(postgresDatabase({query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})}),()=>Date.parse('2026-09-24T15:44:00Z'));
  const raw=JSON.parse(readFileSync(new URL('../fixtures/livescore/discovery.json',import.meta.url)));
  const service=new IntelligenceService(store,{MNEMBA_LIVESCORE_ENABLED:'1'},{fetcher:async()=>Response.json(raw),sleep:async()=>{}});await service.initialize();
  const result=await liveTick(service);assert.equal(result.state,'success',JSON.stringify(result));assert.equal(result.raw,2);assert.equal(result.persisted,2);
  assert.equal((await store.one("SELECT COUNT(*) n FROM fixture_identities WHERE fixture_id LIKE 'livescore:%'")).n,2);
  assert.equal((await liveSnapshot(store,'livescore:1894365')).fixture.homeScore,2);
  assert.equal((await service.read(new URLSearchParams({view:'matchday',day:'today',timezone:'UTC'}))).count,2);

 }finally{await client.query('RESET search_path');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();}
});
