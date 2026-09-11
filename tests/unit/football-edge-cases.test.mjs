import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiCompetition,apiFixture,fdFixture} from '../football-db.mjs';
import {FootballService,dueJobs} from '../../lib/football/service.mjs';
import {Provider,normalizeFixture} from '../../lib/football/providers.mjs';
import {normalizeOpenHistory,normalizeStatsBomb} from '../../lib/football/history.mjs';
import {syncNews} from '../../lib/football/news.mjs';
import {readFileSync} from 'node:fs';
import {migration} from '../../lib/football/schema.mjs';

test('exported migration matches the runtime source exactly',()=>assert.equal(readFileSync(new URL('../../drizzle/0001_global_football.sql',import.meta.url),'utf8'),migration.join(';\n\n')+';\n'));
test('historical calendar selection never schedules live-provider season requests',()=>{
 const jobs=dueJobs({visible:true,now:Date.now(),competition:'statsbomb:53',season:'statsbomb:53:315'});
 assert.ok(!jobs.some(job=>job.endsWith('statsbomb:53:315')));
});
test('fetch adapters do not bind native fetch to service instances',async()=>{
 const {store,sqlite}=database();await store.init();
 const fetcher=async function(_url,options){assert.equal(this,undefined);if(options)assert.equal(options.redirect,'manual');return Response.json({response:[]});};
 await new Provider('api-football','mock',store,{fetcher}).request('fixtures');
 await new FootballService(store,{}, {fetcher}).fetcher('https://example.invalid');sqlite.close();
});
test('historical normalizers import only published completed results and preserve stable IDs',()=>{
 const entry={provider:'openfootball',competitionId:'gh.1',seasonId:'2025-26',season:'2025-26',name:'Historical Ghana'};
 const match={date:'2026-01-01',team1:'Alpha',team2:'Beta',score:{ft:[0,0]}};
 const rows=normalizeOpenHistory({matches:[match,{date:'2026-01-02',team1:'Alpha',team2:'Beta'}]},entry);
 assert.equal(rows.length,1);assert.equal(rows[0].label,'Historical');assert.equal(rows[0].homeScore,0);assert.equal(rows[0].id,normalizeOpenHistory({matches:[{...match,score:{ft:[1,0]}}]},entry)[0].id);
 const stats=normalizeStatsBomb([{match_id:1,match_status:'available',match_date:'2020-01-01',kick_off:'12:30:00.000',home_team:{home_team_id:1,home_team_name:'Home'},away_team:{away_team_id:2,away_team_name:'Away'},home_score:2,away_score:1}],{competitionId:3,seasonId:4,season:'2020',name:'Cup',country:'Country'});
 assert.equal(stats[0].id,'statsbomb:1');assert.equal(stats[0].startsAt,Date.parse('2020-01-01T12:30:00Z'));
});
test('429 Retry-After pauses attempts and stores long backoff without consuming more quota',async()=>{
 const {store,sqlite}=database();await store.init();let calls=0;
 const provider=new Provider('api-football','mock',store,{fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});},sleep:async()=>assert.fail('Must persist long backoff')});
 await assert.rejects(provider.request('fixtures'),/backoff/);assert.equal(calls,1);assert.equal((await store.budget()).used,1);assert.equal((await store.cache('backoff:api-football')).stale,false);sqlite.close();
});
test('primary quota exhaustion falls back to supported Football-Data fixtures',async()=>{
 const {store,sqlite}=database();await store.init();await store.providerRemaining(0);let calls=0;
 const service=new FootballService(store,{API_FOOTBALL_KEY:'mock',FOOTBALL_DATA_KEY:'mock'},{fetcher:async url=>{calls++;assert.equal(url.hostname,'api.football-data.org');return Response.json({matches:[fdFixture]});}});
 await service.fixtureList('today');assert.equal(calls,1);assert.equal((await store.one('SELECT provider FROM fixtures')).provider,'football-data');assert.equal((await store.cache('primary-fallback')).data.reason,'quota-exhausted');sqlite.close();
});
test('news sync rejects unverified sources and ignores NewsAPI outside development',async()=>{
 const {store,sqlite}=database();await store.init();let newsCalls=0;
 const feed='<rss><channel><item><title>Verified football result</title><link>https://www.bbc.com/sport/verified</link><description>Metadata only</description><pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate><content:encoded>Never store full article</content:encoded></item></channel></rss>';
 await syncNews(store,{newsKey:'mock',development:false,fetcher:async url=>{if(url.includes('newsapi.org'))newsCalls++;return new Response(url.includes('bbci')?feed:'<html>not a feed</html>');}});
 assert.equal(newsCalls,0);assert.equal((await store.one('SELECT COUNT(*) n FROM news_articles')).n,1);assert.ok(!(await store.one('SELECT payload FROM news_articles')).payload.includes('full article'));sqlite.close();
});
test('visible scheduler makes no provider calls while closed and never repeats a fresh job',async()=>{
 const {store,sqlite}=database();await store.init();let calls=0;
 const service=new FootballService(store,{API_FOOTBALL_KEY:'mock'},{fetcher:async()=>{calls++;return Response.json({response:[apiCompetition]});}});
 assert.equal((await service.tick({visible:false})).status,'idle');assert.equal(calls,0);
 await service.job('catalog:api-football');await service.job('catalog:api-football');assert.equal(calls,1);
 await service.read(new URLSearchParams({view:'catalog'}));await service.read(new URLSearchParams({view:'fixtures'}));assert.equal(calls,1);sqlite.close();
});
test('manual requests use the eight-request pool and are throttled',async()=>{
 const {store,sqlite}=database();await store.init();const service=new FootballService(store,{API_FOOTBALL_KEY:'mock'},{fetcher:async()=>Response.json({response:[apiCompetition]})});
 assert.equal((await service.job('catalog:api-football',true)).status,'success');assert.equal((await store.budget()).categories.retry,1);assert.equal((await service.job('catalog:api-football',true)).status,'cached');sqlite.close();
});
test('predictions cannot be inserted at or after kickoff at the SQL boundary',async()=>{
 const {store,sqlite}=database();await store.init();const service=new FootballService(store);const fixture=normalizeFixture('api-football',apiFixture());await service.saveFixtures([fixture]);
 await assert.rejects(store.upsert('model_predictions',{id:'late',fixture_id:fixture.id,model_version:'test',created_at:fixture.startsAt,kickoff_at:fixture.startsAt,label:'PitchPredict model projection',payload:'{}'}),/CHECK/);sqlite.close();
});
