import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture,fdFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {normalizeOpenFile,parseFootballText} from '../../lib/football/adapters.mjs';
import {ingestionHealth,ingestFixtureBatch} from '../../lib/football/fixture-ingestion.mjs';
import {runScheduled} from '../../lib/football/scheduled.mjs';
async function setup(env={}){const x=database();x.store.now=()=>Date.parse('2026-09-24T10:00:00Z');await x.store.init();x.service=new IntelligenceService(x.store,env);await x.service.initialize();return x;}

test('successful primary provider cannot suppress secondary provider fixtures; malformed records are counted',async()=>{
 const {service,store,sqlite}=await setup({API_FOOTBALL_KEY:'synthetic',FOOTBALL_DATA_KEY:'synthetic'});
 try{
  const calls=[];service.provider=async name=>{calls.push(name);return name==='api-football'?{response:[apiFixture(1,'NS','2026-09-24T16:00:00Z'),{}]}:{matches:[{...fdFixture,utcDate:'2026-09-24T18:00:00Z'}]};};
  const result=await service.fixtureList('today');assert.deepEqual(calls,['api-football','football-data']);
  assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,2);
  assert.deepEqual(result.providers.map(r=>[r.raw,r.normalized,r.rejected,r.persisted]),[[2,1,1,1],[1,1,0,1]]);
 }finally{sqlite.close();}
});

test('one failing provider cannot prevent the other provider from persisting',async()=>{
 const {service,store,sqlite}=await setup({API_FOOTBALL_KEY:'synthetic',FOOTBALL_DATA_KEY:'synthetic'});
 try{service.provider=async name=>{if(name==='api-football')throw Error('Source unavailable');return {matches:[fdFixture]};};
 const result=await service.fixtureList('today');assert.equal(result.providers[0].state,'error');assert.equal(result.providers[1].persisted,1);assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,1);
 }finally{sqlite.close();}
});

test('API-Football calendar covers seven days without next-99 truncation or repeated daily quota use',async()=>{
 const {service,sqlite}=await setup({API_FOOTBALL_KEY:'synthetic'});
 try{
  const dates=[];service.provider=async(name,path,params)=>{assert.equal(params.next,undefined);dates.push(params.date);return{response:[apiFixture(Number(params.date.slice(-2)),'NS',params.date+'T16:00:00Z')]};};
  await service.fixtureList('today');await service.fixtureList('upcoming');await service.fixtureList('upcoming');
  assert.deepEqual(dates,Array.from({length:7},(_,i)=>`2026-09-${24+i}`));
 }finally{sqlite.close();}
});

test('fixture horizon requests all seven dates and surfaces sparse inventory as degraded',async()=>{
 const {service,store,sqlite}=await setup();
 try{
  const requested=[];service.sports.fixtures=async(day,counts)=>{requested.push(day);counts.raw=1;return [normalizeFixture('api-football',apiFixture(Number(day.slice(-2)),'NS',day+'T16:00:00Z'))];};
  const result=await service.sync('fixtures');assert.equal(requested.length,7);assert.equal(result.health.raw,7);assert.equal(result.health.inserted,7);assert.equal(result.health.inventory.current,7);assert.equal(result.outcome,'degraded');
  assert.ok(result.providers.some(p=>p.reason==='Missing API_FOOTBALL_KEY'));
  assert.equal((await store.cache('fixture-ingestion-health')).data.state,'degraded');
 }finally{sqlite.close();}
});

test('unchanged fixture refresh updates observation time without full persistence or regrading',async()=>{
 const {service,store,sqlite}=await setup();
 try{
  const f=normalizeFixture('api-football',apiFixture(5,'NS','2026-09-24T16:00:00Z'));await service.saveFixtures([f]);
  await store.run('UPDATE fixtures SET updated_at=1 WHERE id=?',f.id);
  service.saveFixtures=async()=>{throw Error('Unchanged fixture must not trigger regrading');};
  const report=await ingestFixtureBatch(service,'api-football',{},counts=>{counts.raw=2;return[f,{...f}];});
  assert.equal(report.state,'success');assert.equal(report.deduplicated,1);assert.equal(report.unchanged,1);assert.equal(report.persisted,1);assert.equal((await store.one('SELECT updated_at FROM fixtures WHERE id=?',f.id)).updated_at,store.now());
 }finally{sqlite.close();}
});

test('date-TBC rounds cannot inherit a previous round date or inflate daily fixture counts',async()=>{
 const text='= Belgian League\n▪ 7. Round\nSun Sep 20\nHome A v Away A\n▪ 8. Round (datum TBC)\nHome B v Away B\nHome C v Away C\n▪ 9. Round\nFri Oct 9\nHome D v Away D';
 const parsed=parseFootballText(text,{year:2026});assert.equal(parsed.rawCount,4);assert.equal(parsed.fixtures.length,2);
 const result=await normalizeOpenFile(text,{repository:'belgium',path:'2026-27/be1.txt',year:2026,season:'2026-27',url:'https://raw.githubusercontent.com/openfootball/belgium/master/2026-27/be1.txt'});
 assert.equal(result.rawCount,4);assert.equal(result.rejectedCount,2);assert.deepEqual(result.fixtures.map(f=>f.date),['2026-09-20','2026-10-09']);
});

test('health detects relative inventory collapse, empty successes, and scheduler surfaces degradation',async()=>{
 const reports=[{provider:'openfootball',attempted:true,state:'success',raw:30,normalized:30,persisted:30,unchanged:30}];
 const inventory={current:20,future:100,providers:[{provider:'openfootball',canonical:10},{provider:'openligadb',canonical:10}]};
 assert.equal(ingestionHealth(reports,inventory).state,'healthy');
 assert.equal(ingestionHealth(reports,inventory,[{current:100},{current:120},{current:110}]).state,'degraded');
 assert.equal(ingestionHealth([{provider:'openfootball',attempted:true,state:'success'}],inventory).state,'degraded');
 const {db,store,sqlite}=database();try{await store.init();const result=await runScheduled({cron:'0 * * * *',scheduledTime:Date.now()},{DB:db},{service:{initialize:async()=>{},sync:async job=>({outcome:job==='fixtures'?'degraded':'success'})}});assert.equal(result.state,'partial');assert.equal(result.results[0].state,'degraded');}finally{sqlite.close();}
});
