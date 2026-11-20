import assert from 'node:assert/strict';
import {normalizeOpenFile} from '../../lib/football/adapters.mjs';
import {PRIORITIES,priorityFor,selectPriorityFiles,coverageMatrix} from '../../lib/football/priority-coverage.mjs';
import {database} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
const entry={id:'tz',repository:'world',path:'africa/tanzania/2025-26_tz1.txt',year:2025,season:'2025-26',url:'https://raw.githubusercontent.com/openfootball/world/master/africa/tanzania/2025-26_tz1.txt'};
const parsed=await normalizeOpenFile('= Tanzania | Premier League 2025/26\n# Source https://www.rsssf.org/tablest/tanz2026.html\n▪ Matchday 1\nWed Sep 17 2025\nYoung Africans SC v Simba SC  2-1\n',entry);
assert.equal(parsed.fixtures[0].competition.country.name,'Tanzania');
assert.equal(priorityFor(parsed.fixtures[0].competition).id,'tanzania');
assert.equal(parsed.fixtures[0].kickoffPrecision,'date');
assert.match(parsed.fixtures[0].sourceAttribution,/Karel Stokkermans/);
assert.equal(priorityFor({name:'Premier League',country:{name:'England'}}).id,'epl');
assert.equal(priorityFor({name:'Tanzania Women’s Premier League',country:{name:'Tanzania'}}).id,'tanzania-women');
assert.equal(new Set(PRIORITIES.map(r=>r.id)).size,PRIORITIES.length);
const other={id:'nl',repository:'football.json',path:'2026-27/nl.1.json',year:2026};
assert.deepEqual(selectPriorityFiles([other,entry],2026).map(f=>f.id),['tz','nl']);
const olderSecondTier={id:'de-old',repository:'football.json',path:'2024-25/de.2.json',year:2024};
assert.deepEqual(selectPriorityFiles([olderSecondTier,other,entry],2026).map(f=>f.id),['tz','nl','de-old'],'Older backfills must not starve current editions in other leagues');
assert.equal(priorityFor({name:"UEFA Women's Euro",country:{name:'Europe'}}).id,'women-euro');
const {store,sqlite}=database();try{await store.init();const service=new IntelligenceService(store);await service.initialize();await service.saveFixtures(parsed.fixtures);await service.saveFixtures(parsed.fixtures);assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,1);const coverage=await coverageMatrix(service),tz=coverage.competitions.find(c=>c.id==='tanzania');assert.equal(tz.fixtures,1);assert.equal(tz.results,1);assert.equal(tz.live,0);assert.equal(tz.verifiedUpcoming,0);assert.equal(tz.badges,0);assert.equal(coverage.competitions.find(c=>c.id==='denmark').fixtures,0);}finally{sqlite.close();}
console.log('Worldwide: Tanzania first, country/gender separation, attribution, idempotence and honest coverage passed');
const {permissionState,sourceById}=await import('../../lib/football/source-registry.mjs');
for(const id of ['kaggle-espn','highlightly','sportmonks','clubelo','scorebat'])assert.equal(permissionState(sourceById(id),{HIGHLIGHTLY_API_KEY:'test',SPORTMONKS_API_TOKEN:'test',SCOREBAT_API_TOKEN:'test'}).enabled,false,'A configured key must not bypass unresolved rights: '+id);
const {runScheduled,CRON_JOBS}=await import('../../lib/football/scheduled.mjs');
const scheduledDb=database();try{await scheduledDb.store.init();const calls=[];const result=await runScheduled({cron:'20 */3 * * *',scheduledTime:Date.now()},{DB:scheduledDb.db},{service:{initialize:async()=>{},sync:async job=>{calls.push(job);return {skipped:job==='media'?23:0,outcome:'success'};}}});assert.equal(result.state,'success');assert.deepEqual(calls,CRON_JOBS['20 */3 * * *'],'Skipped individual media records must not defer news/documents');}finally{scheduledDb.sqlite.close();}
const {normalizeOpenLiga}=await import('../../lib/football/openligadb.mjs');
const raw={matchID:1,leagueShortcut:'bl1',leagueSeason:2026,matchDateTimeUTC:'2026-09-20T13:30:00Z',team1:{teamId:1,teamName:'Home'},team2:{teamId:2,teamName:'Away'},matchIsFinished:true,matchResults:[{resultTypeKind:'HalfTime',pointsTeam1:3,pointsTeam2:0},{resultTypeKind:'After90Minutes',pointsTeam1:3,pointsTeam2:2}]};
assert.equal(normalizeOpenLiga(raw,'bl1',2026).awayScore,2);
assert.equal(normalizeOpenLiga({...raw,matchResults:[raw.matchResults[0]]},'bl1',2026).status,'UNKNOWN');
assert.equal(normalizeOpenLiga(raw,'bl1',2026).home.logo,undefined);
assert.throws(()=>normalizeOpenLiga({...raw,matchDateTimeUTC:'2026-09-20T13:30:00'},'bl1',2026),/UTC/);
assert.throws(()=>normalizeOpenLiga(raw,'bl2',2026),/mismatch/);
const openDb=database();try{await openDb.store.init();const s=new IntelligenceService(openDb.store);await s.initialize();await s.saveFixtures([normalizeOpenLiga(raw,'bl1',2026)]);assert.equal((await openDb.store.one("SELECT COUNT(*) n FROM fixtures WHERE provider='openligadb'")).n,1);}finally{openDb.sqlite.close();}
