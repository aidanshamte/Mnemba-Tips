import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {publicHistory} from '../../lib/football/forecast-history.mjs';
test('history filters before pagination, preserves date-only days and separates previews from grading',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-13T12:00:00Z');
 try{
  await store.init();const service=new IntelligenceService(store);await service.initialize();
  const fixtures=Array.from({length:24},(_,i)=>normalizeFixture('api-football',apiFixture(9000+i,'NS',i===0?'2026-09-13T01:00:00Z':'2026-09-13T12:00:00Z',100+i,200+i)));
  fixtures[1].kickoffPrecision='date';fixtures[1].startsAt=Date.parse('2026-09-13');await service.saveFixtures(fixtures);
  for(const [i,f] of fixtures.entries())await store.run('INSERT INTO exploratory_estimates VALUES(?,?,?,?,?)','preview:'+i,f.id,store.now()+i,'revision',JSON.stringify({probabilities:[.5,.3,.2]}));
  const read=(tab,offset=0)=>publicHistory(service,new URLSearchParams({tab,timezone:'America/New_York',offset:String(offset)}));
  assert.equal((await read('today')).matches.length,20);assert.equal((await read('today',20)).matches.length,3);
  assert.equal((await read('yesterday')).matches[0].fixture.id,fixtures[0].id);
  assert.equal((await read('pending')).matches.length,0);assert.equal((await read('completed')).matches.length,0);
  assert.equal((await read('exploratory')).matches[0].archive.versions.length,0);
  const f=fixtures[2],saved=f.startsAt-3600000;
  await store.run('INSERT INTO analysis_forecasts VALUES(?,?,?,?,?,?,?,?,?)','tracked',f.id,'poisson-temporal-1',saved,f.startsAt,saved,1,JSON.stringify({probabilities:[.5,.3,.2]}),'[]');
  assert.equal((await read('pending')).matches.length,1);
  await store.run('INSERT INTO analysis_grade_audit VALUES(?,?,?,?,?,?,?)','audit','tracked',f.id,store.now(),'void','r',JSON.stringify({reason:'Cancelled'}));
  assert.equal((await read('pending')).matches.length,0);assert.equal((await read('completed')).matches.length,1);
  assert.equal((await read('all',20)).matches.length,4);
 }finally{sqlite.close();}
});
