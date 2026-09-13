import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,apiCompetition,apiFixture,fdFixture} from '../football-db.mjs';
import {normalizeCompetition,normalizeFixture,Provider,featuredCategory} from '../../lib/football/providers.mjs';
import {Store,QuotaError} from '../../lib/football/store.mjs';
import {migration} from '../../lib/football/schema.mjs';
import {form,headToHead,predictedLineup,project,evaluate} from '../../lib/football/model.mjs';
import {FEEDS,article,canonicalUrl,parseFeed,deduplicate} from '../../lib/football/news.mjs';
import {dueJobs,INTERVALS,FootballService} from '../../lib/football/service.mjs';

test('additive migration preserves basketball, is idempotent and enforces foreign keys',async()=>{
 const {sqlite,store}=database();sqlite.exec(readFileSync(new URL('../../drizzle/0000_yummy_gertrude_yorkes.sql',import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO teams(external_id,sport,name) VALUES('b1','basketball','Preserved')");await store.init();await store.init();
 assert.equal(sqlite.prepare("SELECT name FROM teams WHERE sport='basketball'").get().name,'Preserved');
 assert.throws(()=>sqlite.prepare("INSERT INTO season_teams VALUES('missing','missing')").run(),/FOREIGN KEY/);
 assert.ok(migration.some(sql=>sql.includes('idx_football_fixture_home')));sqlite.close();
});
test('provider contracts normalize both providers without ID collisions or invented scores',()=>{
 const a=normalizeFixture('api-football',apiFixture()),b=normalizeFixture('football-data',fdFixture);
 assert.notEqual(a.id,b.id);assert.notEqual(a.home.id,b.home.id);assert.equal(a.homeScore,null);assert.equal(a.elapsed,null);assert.equal(a.label,'Confirmed');
 assert.equal(normalizeFixture('api-football',apiFixture(1,'1H')).label,'Live');
 assert.throws(()=>normalizeFixture('api-football',{...apiFixture(),teams:{}}),/team ID/);
 assert.equal(normalizeCompetition('api-football',apiCompetition).seasons[0].coverage.injuries,true);
 assert.equal(featuredCategory({name:'Premier League',country:{name:'Ghana'}}),null);
});
test('daily budget is persistent, concurrent-safe, allocated and resets at UTC midnight',async()=>{
 const {db,store,sqlite}=database();store.now=()=>Date.parse('2026-09-10T23:59:00Z');await store.init();
 const outcomes=await Promise.allSettled(Array.from({length:70},()=>store.reserve('live')));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,48);
 const other=new Store(db,store.now);assert.equal((await other.budget()).used,48);
 for(const category of ['fixtures','details','statistics','retry'])for(let i=0;i<({fixtures:10,details:20,statistics:10,retry:8})[category];i++)await store.reserve(category);
 assert.equal((await store.budget()).used,96);await assert.rejects(store.reserve('live'),QuotaError);
 for(let i=0;i<4;i++)await store.reserve('reserve');assert.equal((await store.budget()).remaining,0);
 await assert.rejects(store.reserve('reserve'),QuotaError);store.now=()=>Date.parse('2026-09-11T00:00:00Z');assert.equal((await store.budget()).used,0);sqlite.close();
});
test('provider reported remaining budget is honored',async()=>{const {store,sqlite}=database();await store.init();await store.providerRemaining(0);await assert.rejects(store.reserve('details'),QuotaError);sqlite.close();});
test('cache and job leases survive separate store instances and respect expiry',async()=>{
 const {store,db,sqlite}=database();let now=1000;store.now=()=>now;await store.init();await store.putCache('fixture',{score:0},50);assert.equal((await store.cache('fixture')).stale,false);now+=51;assert.equal((await store.cache('fixture')).stale,true);assert.equal((await store.cache('fixture')).data.score,0);
 const owner=await store.lock('job',10);assert.ok(owner);assert.equal(await new Store(db,()=>now).lock('job'),null);await store.unlock('job','wrong-owner');assert.equal(await store.lock('job'),null);now+=11;assert.ok(await store.lock('job'));sqlite.close();
});
test('mocked HTTP contracts, backoff and retries count every primary request',async()=>{
 const {store,sqlite}=database();await store.init();let calls=0;const delays=[];
 const provider=new Provider('api-football','test-only',store,{sleep:async ms=>delays.push(ms),fetcher:async(url,options)=>{assert.equal(url.hostname,'v3.football.api-sports.io');assert.equal(options.headers['x-apisports-key'],'test-only');calls++;return new Response(JSON.stringify({response:[apiCompetition],errors:{}}),{status:calls<3?503:200});}});
 assert.equal((await provider.request('leagues',{},'statistics')).response.length,1);assert.deepEqual(delays,[1000,2000]);assert.equal((await store.budget()).used,3);assert.equal((await store.budget()).categories.retry,2);
 const fd=new Provider('football-data','test-only',store,{fetcher:async(url,options)=>{assert.equal(url.pathname,'/v4/matches');assert.equal(options.headers['X-Auth-Token'],'test-only');return Response.json({matches:[fdFixture]});}});assert.equal((await fd.request('matches')).matches.length,1);assert.equal((await store.budget()).used,3);sqlite.close();
});
test('head-to-head reverses home and away accurately and excludes future/nonfinal matches',()=>{
 const fixtures=[normalizeFixture('api-football',apiFixture(1,'FT','2026-01-01T00:00:00Z')),normalizeFixture('api-football',apiFixture(2,'FT','2026-01-02T00:00:00Z',20,10)),normalizeFixture('api-football',apiFixture(3))];
 const h=headToHead(fixtures,'api-football:10','api-football:20');assert.equal(h.games,2);assert.equal(h.homeWins,1);assert.equal(h.awayWins,1);
 assert.deepEqual(form(fixtures,'api-football:10').results,['W','L']);assert.equal(form(fixtures,'api-football:10').score,1/3);assert.equal(form(fixtures,'api-football:10',Infinity,'home').score,1);
});
test('projected lineup requires complete positional evidence and excludes unavailable players',()=>{
 const positions=['GK',...Array(4).fill('DEF'),...Array(3).fill('MID'),...Array(3).fill('FWD')];const players=positions.map((position,id)=>({id,position,minutes:900,rating:7,availability:'unknown'}));
 assert.equal(predictedLineup(players).label,'Mnemba Tips model estimate');assert.equal(predictedLineup(players).players.length,11);players[0].availability='suspended';assert.equal(predictedLineup(players).label,'Unavailable');assert.equal(predictedLineup([]).players.length,0);
});
test('prediction omits unavailable signals and final-result evaluation does not use provider predictions',()=>{
 const history=Array.from({length:8},(_,i)=>normalizeFixture('api-football',apiFixture(i,'FT',`2026-01-${String(i+1).padStart(2,'0')}T00:00:00Z`,i%2?20:10,i%2?10:20)));
 const f=normalizeFixture('api-football',apiFixture(99));const prediction=project(f,history);assert.equal(prediction.label,'Mnemba Tips model estimate');assert.ok(Math.abs(prediction.probabilities.reduce((a,b)=>a+b,0)-1)<1e-9);assert.ok(prediction.missing.includes('expectedGoals'));assert.equal(evaluate(prediction,f),null);assert.ok(evaluate(prediction,{...f,status:'FT',homeScore:1,awayScore:0}).brier>=0);assert.equal(project(f,[]).label,'Unavailable');
});
test('news allowlist rejects spoofed hosts, invalid dates, script URLs and full content fields',()=>{
 const source=FEEDS[0];assert.equal(canonicalUrl('https://bbc.co.uk.attacker.com/news',source),null);assert.equal(canonicalUrl('javascript:alert(1)',source),null);
 const raw={url:'https://www.bbc.com/sport/a?utm_source=test#part',headline:'Transfer confirmed',publishedAt:'2026-01-01',summary:'Short summary',content:'DO NOT STORE'};
 const item=article(raw,source);assert.equal(item.url,'https://www.bbc.com/sport/a');assert.equal(item.content,undefined);assert.equal(article({...raw,publishedAt:'bad'},source),null);
});
test('RSS parsing handles CDATA, deduplicates canonical URLs and similar headlines',()=>{
 const xml='<rss><channel><item><title><![CDATA[Team signs new player]]></title><link>https://www.bbc.com/sport/a</link><description><![CDATA[<b>Short</b> summary]]></description><pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate></item></channel></rss>';
 const items=parseFeed(xml,FEEDS[0]);assert.equal(items[0].summary,'Short summary');assert.equal(deduplicate([...items,{...items[0],url:'https://www.bbc.com/sport/b'}]).length,1);assert.throws(()=>parseFeed('<!DOCTYPE x>'+xml,FEEDS[0]),/unsafe/);
});
test('scheduler fake timers: visibility, no-live suppression and selected five-minute cadence',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-09-10T12:00:00Z')});
 const {store,sqlite}=database();await store.init();const fixture=normalizeFixture('api-football',apiFixture(1,'1H'));
 assert.deepEqual(dueJobs({now:Date.now(),visible:false,fixtures:[fixture]}),[]);
 assert.ok(!dueJobs({now:Date.now(),visible:true,fixtures:[]}).includes('live'));
 assert.ok(dueJobs({now:Date.now(),visible:true,fixtures:[fixture],selected:fixture.id}).includes(`selected:${fixture.id}`));
 await store.putCache('selected',{},INTERVALS.selected);t.mock.timers.tick(299999);assert.equal((await store.cache('selected')).stale,false);t.mock.timers.tick(1);assert.equal((await store.cache('selected')).stale,true);sqlite.close();
});
test('duplicate records upsert and fixture imports cannot erase catalog coverage',async()=>{
 const {store,sqlite}=database();await store.init();const service=new FootballService(store);await service.saveCompetition(normalizeCompetition('api-football',apiCompetition));const f=normalizeFixture('api-football',apiFixture());await service.saveFixtures([f,f]);assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,1);assert.equal(JSON.parse((await store.one('SELECT coverage FROM seasons')).coverage).injuries,true);sqlite.close();
});
