import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {groupCompetitions} from '../../lib/football/competition-catalog.mjs';
import {goalMarkets,settleGoals} from '../../lib/football/markets.mjs';
import {scoreDistribution} from '../../lib/football/temporal.mjs';
import {estimateMigration} from '../../lib/football/schema-v5.mjs';
test('competition grouping preserves all filter IDs and separates distinct divisions',()=>{
 const groups=groupCompetitions([{id:'a',name:'English Premier League',fixtureCount:380},{id:'b',name:'Premier League',fixtureCount:10},{id:'c',name:'2. Fußball-Bundesliga'},{id:'d',name:'UEFA Europa League - Quali'},{id:'e',name:'UEFA Europa League'}]);
 assert.deepEqual(groups.find(c=>c.name==='Premier League').providerIds,['a','b']);assert.equal(groups.find(c=>c.name==='Premier League').fixtureCount,390);assert.equal(groups.length,3);
});
test('goal markets conserve probability and integer-line settlement returns pushes',()=>{
 const m=goalMarkets(scoreDistribution(1.7,1.2));for(const r of [...m.totals,...m.teamTotals.home,...m.teamTotals.away])assert.ok(Math.abs(r.over+r.under+r.push-1)<1e-10);
 for(const r of m.handicap)assert.ok(Math.abs(r.win+r.push+r.loss-1)<1e-10);
 assert.equal(settleGoals(2,1,{kind:'handicap',line:-1}),'push');assert.equal(settleGoals(1,1,{kind:'total',side:'both',line:2}),'push');assert.equal(settleGoals(0,0,{kind:'total',side:'both',line:.5}),'loss');assert.ok(Math.abs(m.doubleChance.homeOrDraw-(m.result.home+m.result.draw))<1e-10);
});
test('date-only estimates persist separately, reuse cache, and abstain on conflicts',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-10T12:00:00Z');try{
 await store.init();await store.init();assert.equal(readFileSync(new URL('../../drizzle/0005_exploratory_estimates.sql',import.meta.url),'utf8'),estimateMigration.join(';\n')+';\n');
 const service=new IntelligenceService(store);await service.initialize();const history=[1,2,3,4].map(i=>normalizeFixture('api-football',apiFixture(1000+i,'FT',`2026-09-0${i}T12:00:00Z`)));const fixture={...normalizeFixture('api-football',apiFixture(1010,'NS','2026-09-12T12:00:00Z')),kickoffPrecision:'date'};await service.saveFixtures([...history,fixture]);
 const params=()=>new URLSearchParams({view:'analysis',id:fixture.id});const first=await service.read(params());assert.equal(first.analysis.estimateKind,'exploratory');assert.equal(first.analysis.asOf,store.now());assert.ok(first.analysis.markets);await service.read(params());assert.equal((await store.one('SELECT COUNT(*) n FROM exploratory_estimates')).n,1);assert.equal((await store.one('SELECT COUNT(*) n FROM analysis_forecasts')).n,0);await assert.rejects(store.run("UPDATE exploratory_estimates SET revision='changed'"),/immutable/);
 const identity=await store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',fixture.id);await store.run("INSERT INTO evidence_conflicts(id,entity_id,field,claims,status,detected_at) VALUES(?,?,?,'[]','open',?)",'conflict',identity.canonical_id,'startsAt',store.now());assert.equal((await service.read(params())).analysis.probabilities,undefined);
 }finally{sqlite.close();}
});
test('fixture filters run in the database with combined competition IDs and confederation',async()=>{
 const {store,sqlite}=database();try{await store.init();const service=new IntelligenceService(store);await service.initialize();const f=normalizeFixture('api-football',apiFixture(1200,'FT','2026-01-01T12:00:00Z'));f.competition.confederation='CAF';await service.saveFixtures([f]);
 const result=await service.read(new URLSearchParams({view:'fixtures',competition:f.competition.id+',other',q:f.home.name,confederation:'CAF'}));assert.equal(result.fixtures.length,1);assert.equal((await service.read(new URLSearchParams({view:'fixtures',q:'missing'}))).fixtures.length,0);
 }finally{sqlite.close();}
});

test('documented generated mirrors consolidate exact participants and preserve conflicting claims',async()=>{
 const {store,sqlite}=database();try{await store.init();const service=new IntelligenceService(store);await service.initialize();
 const {normalizeOpenFile}=await import('../../lib/football/adapters.mjs');const {reconcileGeneratedMirrors}=await import('../../lib/football/mirrors.mjs');
 const a={id:'j',repository:'football.json',path:'2025-26/en.1.json',season:'2025-26',year:2025,url:'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json'},b={id:'t',repository:'england',path:'2025-26/1-premierleague.txt',season:'2025-26',year:2025,url:'https://raw.githubusercontent.com/openfootball/england/master/2025-26/1-premierleague.txt'};
 for(const entry of [a,b])await store.run("INSERT INTO source_files(id,source_id,repository,path,url,season,year,format,license_ref,state) VALUES(?,'openfootball',?,?,?,?,?,'json','CC0','imported')",entry.id,entry.repository,entry.path,entry.url,entry.season,entry.year);
 const payload={name:'English Premier League',matches:[{date:'2025-09-01',team1:'Home FC',team2:'Away FC',round:'Matchday 1',score:{ft:[1,0]}}]};const first=await normalizeOpenFile(payload,a),second=await normalizeOpenFile({...payload,matches:[{...payload.matches[0],score:{ft:[2,0]}}]},b);await service.saveFixtures([...first.fixtures,...second.fixtures]);assert.equal((await reconcileGeneratedMirrors(service)).matched,1);const merged=await service.deduplicateFixtures([...first.fixtures,...second.fixtures]);assert.equal(merged.length,1);assert.equal(merged[0].sourceClaims.length,2);assert.equal(merged[0].hasConflict,true);
 }finally{sqlite.close();}
});

test('entity-escaped RSS markup becomes readable plain text before storage and display',async()=>{
 const {cleanText,parseFeed}=await import('../../lib/football/news.mjs');assert.equal(cleanText('&lt;p&gt;Hello &lt;a href="https://example.com/long-url"&gt;fans&lt;/a&gt;&lt;/p&gt;'),'Hello fans');assert.equal(cleanText('&amp;lt;p&amp;gt;Hello&amp;lt;/p&amp;gt;'),'Hello');assert.equal(cleanText('<script>bad()</script>Match news'),'Match news');assert.equal(cleanText('&lt;p&gt;News &lt;a href="https://example.com/truncated'),'News');
 const rows=parseFeed('<rss><channel><item><title>Match news</title><link>https://example.com/story</link><pubDate>2026-09-01T10:00:00Z</pubDate><description>&lt;p&gt;Club &amp; fans&lt;/p&gt;</description></item></channel></rss>',{hosts:['example.com'],publisher:'Example'},Date.parse('2026-09-12'));assert.equal(rows[0].summary,'Club & fans');
});
