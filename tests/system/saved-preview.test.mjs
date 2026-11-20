import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {savedEstimate} from '../../lib/football/estimates.mjs';
import {decideRecommendation} from '../../lib/football/recommendations.mjs';

test('changed evidence preserves a labelled preview on read-only pages, refreshes in writer and survives final',async()=>{
 const {store,sqlite}=database();let now=Date.parse('2026-09-10T12:00:00Z');store.now=()=>now;
 try{
 await store.init();const service=new IntelligenceService(store);await service.initialize();
 const history=[1,2,3,4].map(i=>normalizeFixture('api-football',apiFixture(4000+i,'FT',`2026-09-0${i}T12:00:00Z`)));
 const f={...normalizeFixture('api-football',apiFixture(4100,'NS','2026-09-11T12:00:00Z')),kickoffPrecision:'date'};
 await service.saveFixtures([...history,f]);
 const first=await savedEstimate(service,f,history);assert.ok(first.probabilities);assert.equal(first.asOf,now);
 now+=60000;const revised=history.map(h=>({...h,homeScore:3}));store.readOnly=true;
 const stale=await savedEstimate(service,f,revised);assert.deepEqual(stale.probabilities,first.probabilities);assert.equal(stale.asOf,first.asOf);assert.equal(stale.needsRefresh,true);assert.ok(stale.markets);assert.equal(decideRecommendation(f,stale,now).primary,null);
 store.readOnly=false;const refreshed=await savedEstimate(service,f,revised);assert.equal(refreshed.asOf,now);assert.notDeepEqual(refreshed.probabilities,first.probabilities);
 assert.equal((await store.one('SELECT COUNT(*) n FROM analysis_forecasts')).n,0);
 store.readOnly=true;for(const status of ['1H','FT']){const record=await savedEstimate(service,{...f,status},revised);assert.deepEqual(record.probabilities,refreshed.probabilities);assert.equal(record.historical,true);assert.equal(record.asOf,now);}
 assert.equal((await store.one('SELECT COUNT(*) n FROM exploratory_estimates')).n,2);
 }finally{sqlite.close()}
});

test('a verified timed update captures immutable forecasts without converting its date-only preview',async()=>{
 const {store,sqlite}=database();const now=Date.parse('2026-09-10T12:00:00Z');store.now=()=>now;
 try{await store.init();const service=new IntelligenceService(store);await service.initialize();
 const history=[1,2,3,4].map(i=>normalizeFixture('api-football',apiFixture(5000+i,'FT',`2026-09-0${i}T12:00:00Z`)));
 const f={...normalizeFixture('api-football',apiFixture(5100,'NS','2026-09-11T12:00:00Z')),kickoffPrecision:'date'};await service.saveFixtures([...history,f]);await savedEstimate(service,f,history);
 const timed={...f,kickoffPrecision:'instant'};await service.saveFixtures([timed]);const forecast=await savedEstimate(service,timed,history);
 assert.equal(forecast.estimateKind,'tracked');assert.equal(forecast.archive.exploratory.length,1);assert.equal(forecast.archive.versions.length,2);assert.ok(forecast.archive.versions.every(v=>v.createdAt===now&&v.createdAt<v.kickoffAt));
 await assert.rejects(store.run("UPDATE analysis_forecasts SET payload='{}'"),/immutable/);
 }finally{sqlite.close()}
});

test('background and public presentation wrappers have the same evidence revision',async()=>{
 const {estimateRevision}=await import('../../lib/football/estimates.mjs');
 const f=normalizeFixture('api-football',apiFixture());const history=[{...f,id:'previous',status:'FT',homeScore:2,awayScore:1}];
 const wrapped={...f,label:'Scheduled',lifecycle:{state:'scheduled'},hasConflict:false,sourceClaims:[],home:{...f.home,logo:'https://example.org/image.png'}};
 assert.equal(await estimateRevision(f,history),await estimateRevision(wrapped,history.map(h=>({...h,hasConflict:false,lifecycle:{state:'completed'}}))));
 assert.notEqual(await estimateRevision(f,history),await estimateRevision(f,history.map(h=>({...h,homeScore:3}))));
});

test('model sweep prioritizes current fixtures without excluding later schedules',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-10T12:00:00Z');
 try{await store.init();const service=new IntelligenceService(store);await service.initialize();
 await service.saveFixtures([normalizeFixture('api-football',apiFixture(6100,'NS','2025-01-01')),normalizeFixture('api-football',apiFixture(6101,'NS','2026-09-11')),normalizeFixture('api-football',apiFixture(6102,'NS','2027-01-01'))]);
 const {ModelLab}=await import('../../lib/football/model-lab.mjs');const lab=new ModelLab(service),seen=[];lab.capture=async f=>{seen.push(f.id);return{state:'abstained'}};await lab.update();assert.deepEqual(seen,['api-football:6101','api-football:6102']);
 }finally{sqlite.close()}
});
