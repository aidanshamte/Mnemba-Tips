import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {normalizeLiveScore} from '../../lib/football/livescore.mjs';
import {sourceById} from '../../lib/football/source-registry.mjs';
import {publishLive,liveSnapshot} from '../../lib/football/live.mjs';
import {matchdayRange,inMatchday} from '../../lib/football/matchday.mjs';

async function setup(){
 const x=database();x.store.now=()=>Date.parse('2026-09-24T10:00:00Z');
 await x.store.init();x.service=new IntelligenceService(x.store);await x.service.initialize();return x;
}
const params=()=>new URLSearchParams({view:'matchday',day:'today',timezone:'UTC'});
test('LiveScore enrichment preserves base fixtures without predictions, mappings, statistics, lineups or images',async()=>{
 const {store,sqlite,service}=await setup();
 const source=sourceById('livescore'),permission=source.storageAllowed;
 // Synthetic contract data only; no network or production policy changes.
 source.storageAllowed=true;
 try{
  const base=[1,2,3].map(id=>normalizeFixture('api-football',apiFixture(id,'NS','2026-09-24T16:00:00Z',id*10,id*10+1)));
  await service.saveFixtures(base);
  const before=await service.read(params());assert.equal(before.count,3);assert.equal(before.eligible,0);
  for(const table of ['analysis_forecasts','fixture_statistics','lineups'])assert.equal((await store.one(`SELECT COUNT(*) n FROM ${table}`)).n,0);
  const enriched=normalizeLiveScore({Eid:100,Esd:'2026-09-24T16:00:00Z',Eps:'NS',T1:[{ID:10,Nm:'Team 10'}],T2:[{ID:11,Nm:'Team 11'}]},{Sid:777,Snm:'Regional Cup',Season:2026,Cnm:'Ghana'});
  await service.saveFixtures([enriched]);
  assert.equal((await service.read(params())).count,4,'unmapped provider fixture cannot replace the base set');
  const identity=await store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',base[0].id);
  await store.run("UPDATE fixture_identities SET canonical_id=?,verification='verified-reference' WHERE fixture_id=?",identity.canonical_id,enriched.id);
  await publishLive(service,enriched.id);
  await store.run("DELETE FROM football_cache WHERE id LIKE 'matchday:%'");
  const after=await service.read(params());
  assert.equal(after.count,before.count,'only the explicitly reconciled same match is deduplicated');
  for(const f of base)assert.ok(after.fixtures.some(g=>g.id===f.id||g.sourceClaims.some(c=>c.id===f.id)));
  assert.equal(after.eligible,0);assert.equal(after.picks.length,0);
  assert.equal((await liveSnapshot(store,base[0].id)).resolvedFor,base[0].id);
  assert.equal((await liveSnapshot(store,base[1].id)).unavailable,true);
 }finally{source.storageAllowed=permission;sqlite.close();}
});

test('previously imported source retries after failure and keeps existing fixtures during backoff',async()=>{
 const {store,sqlite,service}=await setup();let now=store.now();store.now=()=>now;
 try{
  const fixture=normalizeFixture('api-football',apiFixture(40,'NS','2026-09-24T16:00:00Z'));
  await service.saveFixtures([fixture]);
  await store.run("INSERT INTO source_files(id,source_id,repository,path,url,season,year,format,state,last_import,fixture_count,license_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",'retry','openfootball','england','2026-27/1-premierleague.txt','https://raw.githubusercontent.com/openfootball/england/master/2026-27/1-premierleague.txt','2026-27',2026,'txt','imported',now-3600000,1,'https://github.com/openfootball/england/blob/master/LICENSE.md');
  service.sports.fixtures=async()=>[];
  let calls=0;service.open.load=async()=>{calls++;throw Error('Temporary source failure');};
  await service.sync('fixtures');assert.equal(calls,1);
  assert.equal((await store.one('SELECT state FROM source_files WHERE id=?','retry')).state,'error');
  assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,1);
  await service.sync('fixtures');assert.equal(calls,1,'failed source respects its retry delay');
  now+=86400001;service.open.load=async()=>{calls++;return {fixtures:[fixture],warnings:[]};};
  const result=await service.sync('fixtures');assert.equal(calls,2);
  assert.equal(result.fixtures,1);assert.equal(result.outcome,'degraded','successful refresh alone does not establish broad current coverage');
  const source=await store.one('SELECT state,error FROM source_files WHERE id=?','retry');assert.equal(source.state,'imported');assert.equal(source.error,null);
 }finally{sqlite.close();}
});

test('matchday API includes the full visitor-local day and preserves date-only fixtures',async()=>{
 const {sqlite,service}=await setup();
 try{
  const times=['2026-09-23T20:59:59Z','2026-09-23T21:00:00Z','2026-09-24T20:59:59Z','2026-09-24T21:00:00Z'];
  const fixtures=times.map((date,i)=>normalizeFixture('api-football',apiFixture(50+i,'NS',date,50+i,60+i)));
  fixtures.push({...normalizeFixture('api-football',apiFixture(60,'NS','2026-09-24T12:00:00Z')),kickoffPrecision:'date'});
  await service.saveFixtures(fixtures);
  const result=await service.read(new URLSearchParams({view:'matchday',day:'today',timezone:'Africa/Dar_es_Salaam'}));
  assert.deepEqual(result.fixtures.map(f=>f.id).sort(),['api-football:51','api-football:52','api-football:60']);
 }finally{sqlite.close();}
});

test('all date presets and DST boundaries retain calendar semantics',()=>{
 const now=Date.parse('2026-09-24T10:00:00Z');
 for(const [day,from,to] of [['yesterday','2026-09-23','2026-09-23'],['today','2026-09-24','2026-09-24'],['tomorrow','2026-09-25','2026-09-25'],['weekend','2026-09-26','2026-09-27'],['week','2026-09-24','2026-09-30'],['date','2026-10-10','2026-10-10'],['custom','2026-10-10','2026-10-12']]){
  const range=matchdayRange(new URLSearchParams({day,from:'2026-10-10',to:'2026-10-12',timezone:'Africa/Dar_es_Salaam'}),now);
  assert.equal(range.from,from);assert.equal(range.to,to);
 }
 for(const [from,hours] of [['2026-03-08',23],['2026-11-01',25]]){
  const range=matchdayRange(new URLSearchParams({day:'date',from,timezone:'America/New_York'}),now);
  assert.equal(range.end-range.start,hours*3600000);
  assert.equal(inMatchday({startsAt:range.start},range),true);
  assert.equal(inMatchday({startsAt:range.end},range),false);
 }
});
