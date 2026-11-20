import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='https://aidanshamte.me';
async function get(path){const r=await fetch(origin+path,{signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,path);return r.json();}
const health=await get('/api/health'),ranges={};assert.equal(health.database,'ready');
for(const day of ['today','tomorrow','week']){
 const d=await get('/api/intelligence?view=matchday&timezone=UTC&day='+day);
 const raw=await get('/api/intelligence?view=fixtures&from='+d.range.from+'&to='+d.range.to);
 assert.equal(d.count,raw.fixtures.length,'selected matchday matches direct database-backed fixture query');
 assert.equal(d.count,d.fixtures.length);assert.ok(d.fixtures.every(f=>f.provider!=='livescore'));
 ranges[day]={count:d.count,eligible:d.eligible,from:d.range.from,to:d.range.to};
}
const overview=await get('/api/intelligence?view=overview'),coverage=await get('/api/intelligence?view=coverage');
const ids=['tanzania','caf-cl','epl','ucl','laliga','bundesliga','serie-a','mls','j1'];
const competitions=coverage.competitions.filter(c=>ids.includes(c.id)).map(c=>({id:c.id,fixtures:c.fixtures,scheduled:c.scheduled,sources:c.sources}));
const available=await get('/api/intelligence?view=matchday&day=date&from=2026-10-10&timezone=UTC');
assert.ok(available.fixtures.some(f=>f.provider==='openfootball'));assert.ok(available.fixtures.some(f=>f.provider==='openligadb'));
const fixture=overview.today[0]??overview.upcoming[0];const live=await get('/api/football/live?id='+encodeURIComponent(fixture.id));
const report={at:new Date().toISOString(),health,ranges,total:overview.counts,competitions,october10:{count:available.count,providers:[...new Set(available.fixtures.map(f=>f.provider))]},live};
mkdirSync('.sites-runtime/regression-recovery',{recursive:true});writeFileSync('.sites-runtime/regression-recovery/production.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
