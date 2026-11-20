import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {liveTick,liveSnapshot,publishLive,pollDelay,uniqueIncidents} from '../../lib/football/live.mjs';
import {liveStream} from '../../lib/football/live-stream.mjs';
import {LiveScoreAdapter,normalizeLiveScore,parseLiveScoreDiscovery,parseLiveScoreIncidents,parseLiveScoreLineups,liveScorePermission} from '../../lib/football/livescore.mjs';
import {permissionState,sourceById} from '../../lib/football/source-registry.mjs';

const event={Eid:12,Esd:'2026-09-21T10:00:00Z',Eps:'1H',Etm:21,T1:[{ID:10,Nm:'Synthetic home'}],T2:[{ID:20,Nm:'Synthetic away'}],Tr1:1,Tr2:0};
const stage={Sid:5,Snm:'Synthetic contract test',Season:2026,Cnm:'Test country',Events:[event]};
test('LiveScore contract candidate rejects missing identities, unknown statuses and ambiguous clocks',()=>{
 const [f]=parseLiveScoreDiscovery({Stages:[stage]});assert.equal(f.id,'livescore:12');assert.equal(f.elapsed,21);assert.equal(f.home.logo,undefined);
 assert.throws(()=>normalizeLiveScore({...event,Esd:20260921100000},stage),/timezone/);
 assert.equal(normalizeLiveScore({...event,Esd:20260921100000},stage,{compactTimestampTimezone:'UTC'}).startsAt,f.startsAt);
 assert.throws(()=>normalizeLiveScore({...event,Eps:'unknown'},stage),/status/);
 assert.throws(()=>normalizeLiveScore({...event,T1:[]},stage),/identity/);
 assert.throws(()=>parseLiveScoreDiscovery({}),/envelope/);
});
test('LiveScore remains network-disabled without enablement or with an unverified contract',async()=>{
 let calls=0;const adapter=new LiveScoreAdapter({json:()=>{calls++;}},{});
 assert.equal(liveScorePermission({}),false);assert.equal(liveScorePermission({MNEMBA_LIVESCORE_ENABLED:'1'},{contractVerified:false}),false);
 assert.equal(permissionState(sourceById('livescore'),{}).enabled,false);
 await assert.rejects(adapter.discovery(),/authorization/);await assert.rejects(adapter.request('matchstats',12),/authorization/);assert.equal(calls,0);
});
test('candidate incidents deduplicate by provider identity and lineups preserve supplied fields',()=>{
 const row={ID:1,Type:'Goal',Minute:21,Player:'Synthetic scorer'};
 const result=parseLiveScoreIncidents({Incidents:[row,{...row,Minute:22}]});assert.equal(result.length,1);assert.equal(result[0].minute,22);
 const lineup=parseLiveScoreLineups({Lineups:[{TeamID:10,TeamName:'Synthetic home',Formation:'4-4-2',Players:[{ID:55,Name:'Synthetic player',Started:true}]}]});assert.equal(lineup[0].formation,'4-4-2');assert.equal(lineup[0].players[0].jersey,null);
 assert.equal(uniqueIncidents([{type:'Goal',minute:2},{minute:2,type:'Goal'}]).length,1);
 assert.ok(pollDelay({status:'FT'})>pollDelay({status:'1H'}));assert.ok(pollDelay({status:'HT'})>pollDelay({status:'1H'}));
});
async function setup(options={}){const {store,sqlite}=database();let now=Date.parse('2026-09-21T10:25:00Z');store.now=()=>now;await store.init();const service=new IntelligenceService(store,options.env??{},options);await service.initialize();return{store,sqlite,service,advance:ms=>{now+=ms;}};}
test('central discovery persists canonical claims, diffs unchanged state and never rewrites forecasts',async()=>{
 let calls=0;const raw=apiFixture(42,'1H','2026-09-21T10:00:00Z');
 const x=await setup({env:{API_FOOTBALL_KEY:'synthetic-test-key'},fetcher:async()=>{calls++;return Response.json({response:[raw]});},sleep:async()=>{}});
 try{
  const f=normalizeFixture('api-football',raw);await x.service.saveFixtures([f]);
  await x.store.upsert('model_predictions',{id:'saved',fixture_id:f.id,model_version:'test',created_at:f.startsAt-1000,kickoff_at:f.startsAt,label:'Pre-match',payload:'{"immutable":true}'});
  const before=await x.store.one('SELECT * FROM model_predictions WHERE id=?','saved');
  assert.equal((await liveTick(x.service)).state,'success');assert.equal(calls,1);
  const state=await liveSnapshot(x.store,f.id);assert.equal(state.fixture.homeScore,2);assert.ok(state.revision);
  assert.ok(await x.store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',f.id));
  assert.equal(await publishLive(x.service,f.id),false);
  assert.deepEqual(await x.store.one('SELECT * FROM model_predictions WHERE id=?','saved'),before);
  const owner=await x.store.lock('football-sync');assert.equal((await liveTick(x.service)).state,'busy');assert.equal(calls,1);await x.store.unlock('football-sync',owner);
  x.advance(31*60000);raw.goals.home=3;assert.equal((await liveTick(x.service)).state,'success');const next=await liveSnapshot(x.store,f.id);assert.equal(next.fixture.homeScore,3);assert.notEqual(next.revision,state.revision);
 }finally{x.sqlite.close();}
});
test('unconfigured worker is idle and failures preserve last published state',async()=>{
 const x=await setup();try{assert.equal((await liveTick(x.service)).state,'not-configured');assert.equal((await liveSnapshot(x.store,'missing')).unavailable,true);}finally{x.sqlite.close();}
 const y=await setup({env:{API_FOOTBALL_KEY:'synthetic-test-key'},fetcher:async()=>{throw Error('network');},sleep:async()=>{}});
 try{await y.store.putCache('live:state:api-football:1',{revision:'old',fixture:{homeScore:1}},86400000);assert.equal((await liveTick(y.service)).state,'unavailable');assert.equal((await liveTick(y.service)).state,'backoff');assert.equal((await liveSnapshot(y.store,'api-football:1')).revision,'old');}finally{y.sqlite.close();}
});
test('SSE sends snapshot and changed revision, reconnect replays latest, abort releases stream',async()=>{
 let state={revision:'one',fixture:{homeScore:0}};const abort=new AbortController();
 const response=liveStream(async()=>state,{signal:abort.signal,interval:5,duration:1000});assert.match(response.headers.get('Content-Type'),/event-stream/);
 const reader=response.body.getReader(),decode=b=>new TextDecoder().decode(b);
 assert.match(decode((await reader.read()).value),/retry/);assert.match(decode((await reader.read()).value),/id: one/);
 state={revision:'two',fixture:{homeScore:1}};assert.match(decode((await reader.read()).value),/id: two/);abort.abort();assert.equal((await reader.read()).done,true);
 const replay=liveStream(async()=>state,{duration:1000}).body.getReader();await replay.read();assert.match(decode((await replay.read()).value),/id: two/);await replay.cancel();
});
