import test from 'node:test';
import assert from 'node:assert/strict';
import { database,apiCompetition,apiFixture } from '../football-db.mjs';
import { FootballService } from '../../lib/football/service.mjs';
import { normalizeFixture } from '../../lib/football/providers.mjs';

test('mocked player statistics persist match appearances and remain searchable as recent form',async()=>{
 const {store,sqlite}=database();await store.init();
 const service=new FootballService(store,{API_FOOTBALL_KEY:'mock'},{fetcher:async url=>{assert.equal(url.pathname,'/fixtures/players');return Response.json({response:[{team:{id:10,name:'Team 10'},players:[{player:{id:1000,name:'Recorded Player'},statistics:[{games:{minutes:87,rating:'7.4',position:'Midfielder'}}]}]}]});}});
 await service.saveFixtures([normalizeFixture('api-football',apiFixture(1,'FT','2026-01-01T12:00:00Z'))]);
 assert.equal((await service.job('player-statistics:api-football:1')).status,'success');
 assert.equal((await store.one('SELECT minutes FROM football_appearances')).minutes,87);
 const result=await service.read(new URLSearchParams({view:'search',q:'Recorded Player'}));assert.equal(result.players[0].recentForm.recentGames[0].rating,7.4);assert.equal(result.players[0].recentForm.scope,'Last ten recorded match appearances');sqlite.close();
});

test('complete mocked API workflow: discover, cache, predict before kickoff, update result, evaluate',async()=>{
 const {store,sqlite}=database();let now=Date.parse('2026-09-10T10:00:00Z');store.now=()=>now;await store.init();let final=false,calls=0;
 const service=new FootballService(store,{API_FOOTBALL_KEY:'mock-key'},{fetcher:async raw=>{calls++;const url=new URL(raw);let response;if(url.pathname==='/leagues')response=[apiCompetition];else if(url.pathname==='/fixtures')response=url.searchParams.has('id')?[apiFixture(100,final?'FT':'NS','2026-09-10T12:00:00Z')]:[...Array.from({length:6},(_,i)=>apiFixture(i+1,'FT',`2026-09-0${i+1}T12:00:00Z`,i%2?20:10,i%2?10:20)),apiFixture(100,'NS','2026-09-10T12:00:00Z')];else throw new Error('Unexpected network request '+url);return Response.json({response,errors:{}});}});
 assert.equal((await service.job('catalog:api-football')).status,'success');assert.equal((await service.job('today')).status,'success');
 const catalog=await service.read(new URLSearchParams({view:'catalog'}));assert.equal(catalog.competitions[0].name,'Regional Cup');
 const page=await service.read(new URLSearchParams({view:'fixtures',competition:'api-football:777'}));assert.equal(page.fixtures.length,7);
 let match=await service.read(new URLSearchParams({view:'match',id:'api-football:100'}));assert.equal(match.prediction.label,'Mnemba Tips model estimate');assert.ok(match.prediction.createdAt<match.fixture.startsAt);assert.equal(match.details.lineups.label,'Unavailable');
 assert.equal((await service.job('today')).status,'cached');assert.equal(calls,2);
 now+=4*3600000;final=true;assert.equal((await service.job('detail:api-football:100')).status,'success');
 const results=await store.all('SELECT * FROM prediction_results');assert.ok(results.length>=1);assert.ok(results[0].brier_score>=0);
 const count=(await store.one('SELECT COUNT(*) n FROM model_predictions')).n;match=await service.read(new URLSearchParams({view:'match',id:'api-football:100'}));await service.predict(match.fixture);assert.equal((await store.one('SELECT COUNT(*) n FROM model_predictions')).n,count);sqlite.close();
});
test('failed refresh retains cached records and exposes provider error without credentials',async()=>{
 const {store,sqlite}=database();await store.init();const service=new FootballService(store,{API_FOOTBALL_KEY:'never-expose-this'},{fetcher:async()=>new Response('no',{status:403})});assert.equal((await service.job('catalog:api-football')).status,'unavailable');const data=await service.read(new URLSearchParams({view:'diagnostics'}));assert.ok(!JSON.stringify(data).includes('never-expose-this'));assert.equal(data.providers[0].configured,true);sqlite.close();
});
