import assert from 'node:assert/strict';
import {normalizeOpenFile} from '../../lib/football/adapters.mjs';
import {FIRST_BATCH,batchCompetition} from '../../lib/football/global-competitions.mjs';
import {selectPriorityFiles,priorityFor} from '../../lib/football/priority-coverage.mjs';
import {matchState,analysisCutoff} from '../../lib/football/match-state.mjs';
const entry={repository:'world',path:'north-america/mexico/2024-25_mx1.txt',year:2024,season:'2024-25',url:'https://raw.githubusercontent.com/openfootball/world/master/north-america/mexico/2024-25_mx1.txt'};
const data=await normalizeOpenFile(`= Liga MX 2024/25
▪ Apertura, Matchday 1
Fri Dec 20 2024
19:00 Alpha FC v Beta FC  1-0 (0-0)
▪ Clausura, Matchday 1
Fri Jan 10
19:00 Beta FC v Alpha FC  2-2 (0-1)
▪ Clausura Playoffs, Final
Sun May 25
Alpha FC v Beta FC
`,entry);
assert.equal(data.fixtures.length,3);
assert.equal(data.fixtures[1].date,'2025-01-10');
assert.equal(data.fixtures[2].round,'Clausura Playoffs, Final');
assert.equal(data.fixtures[0].competition.country.name,'Mexico');
assert.equal(data.fixtures[0].competition.country.continent,'North America');
assert.equal(data.fixtures[0].competition.seasons[0].label,'2024-25');
assert.equal(data.fixtures[0].competition.seasons[0].format,'split-year');
assert.equal(data.fixtures[2].kickoffPrecision,'date');
assert.equal(matchState(data.fixtures[2],Date.parse('2025-05-24')).forecastEligible,false);
assert.equal(analysisCutoff(data.fixtures[2],Date.parse('2025-05-26')),Date.parse('2025-05-25'));
assert.equal(batchCompetition({...entry,path:'north-america/mexico/2024-25_mx2expansion.txt'}),null);
assert.equal(batchCompetition({...entry,repository:'south-america',path:'argentina/2025_ar1.txt'}).id,'argentina');
assert.equal(batchCompetition({...entry,path:'africa/champions-league/2024-25_cafcl.txt'}),null);
assert.equal(priorityFor({name:'Algerian Ligue 1',country:{name:'France'}}),null);
for(const c of FIRST_BATCH)assert.equal(priorityFor({name:c.name,country:{name:c.country}})?.id,c.id);
const files=[{...entry,id:'old',year:2023},{...entry,id:'new',year:2024},{repository:'football.json',path:'2026-27/en.1.json',year:2026,id:'europe'}];
assert.deepEqual(selectPriorityFiles(files,2026).map(f=>f.id),['europe','new'],'Current editions precede older backfills across regions');
assert.deepEqual(selectPriorityFiles([{...entry,year:2027}],2026),[]);
console.log('Global coverage: split seasons, stages, dates, identity, first-batch selection and no inferred kickoff passed');
const {groupCompetitions}=await import('../../lib/football/competition-catalog.mjs');
assert.equal(groupCompetitions([{id:'eg',name:'Premier League',country:{name:'Egypt'}},{id:'en',name:'Premier League',country:{name:'England'}}]).length,2);
const invalid=await normalizeOpenFile({matches:[{date:'2025-02-30',team1:'Alpha',team2:'Beta'}]},entry);
assert.equal(invalid.fixtures.length,0);
assert.equal(data.fixtures[0].competition.seasons[0].current,false);
const penalties=await normalizeOpenFile(`= Liga MX
▪ Play-in
Thu Nov 21 2024
21:00 Club Tijuana v CF América  2-3 pen. (2-2, 1-0)
Fri Nov 22
Alpha FC v Beta FC  [postponed]
`,entry);
assert.equal(penalties.fixtures[0].status,'PEN');
assert.equal(penalties.fixtures[0].homeScore,2);
assert.equal(penalties.fixtures[0].awayScore,2);
assert.deepEqual(penalties.fixtures[0].penaltyScore,{home:2,away:3});
assert.equal(penalties.fixtures[0].regulationScore,undefined,'A pre-shootout score does not prove the 90-minute score');
assert.equal(penalties.fixtures[1].status,'PST');
assert.equal(penalties.fixtures[1].away.name,'Beta FC');
assert.equal(matchState(penalties.fixtures[1],0).previewAllowed,false);
const administrative=await normalizeOpenFile(`= Tanzania | Premier League 2025/26
▪ Matchday 6
Tue Oct 28 2025
Dodoma Jiji FC v Pamba Jiji FC  0-3 [awarded]
Alpha FC 2-1 Beta FC [abandoned]
Gamma FC v Delta FC [walkover]
`,{...entry,year:2025,season:'2025-26',path:'africa/tanzania/2025-26_tz1.txt'});
assert.deepEqual(administrative.fixtures.map(f=>f.status),['AWD','ABD','AWD']);
assert.equal(administrative.fixtures[0].away.name,'Pamba Jiji FC');
assert.equal(administrative.fixtures[0].awayScore,3,'Preserve the published administrative score');
assert.equal(administrative.fixtures[2].away.name,'Delta FC');
assert.equal(matchState(administrative.fixtures[0]).state,'cancelled','Awarded scores must be voided, not graded as played results');
assert.equal(matchState(administrative.fixtures[1]).state,'interrupted');
const {database}=await import('../football-db.mjs');
const {IntelligenceService}=await import('../../lib/football/intelligence.mjs');
const {store,sqlite}=database();await store.init();
const service=new IntelligenceService(store);await service.initialize();
const original={...penalties.fixtures[1],id:'openfootball:legacy-postponed',externalId:'legacy-postponed',sourceUrl:entry.url,status:'NS',away:{...penalties.fixtures[1].away,id:'openfootball:Beta%20FC%20%5Bpostponed%5D',externalId:'Beta FC [postponed]',name:'Beta FC [postponed]'}};
await service.saveFixtures([original]);
await service.saveFixtures([{...penalties.fixtures[1],sourceUrl:entry.url}]);
assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n,1,'Annotation repair retains the existing fixture ID');
const repaired=JSON.parse((await store.one('SELECT payload FROM fixtures')).payload);
assert.equal(repaired.id,original.id);assert.equal(repaired.status,'PST');assert.equal(repaired.away.name,'Beta FC');sqlite.close();
const retryDb=database();retryDb.store.now=()=>Date.parse('2026-09-21T00:00:00Z');await retryDb.store.init();const retryService=new IntelligenceService(retryDb.store);await retryService.initialize();
await retryDb.store.run("INSERT INTO source_files(id,source_id,repository,path,url,season,year,format,license_ref,state,last_import) VALUES(?,?,?,?,?,?,?,?,?,?,?)",'empty-source','openfootball','football.json','2026/empty.json','https://raw.githubusercontent.com/openfootball/football.json/master/2026/empty.json','2026',2026,'json','https://github.com/openfootball/football.json','imported',1);
await retryDb.store.run("INSERT INTO source_files(id,source_id,repository,path,url,season,year,format,license_ref,state,last_import) VALUES(?,?,?,?,?,?,?,?,?,?,?)",'future-placeholder','openfootball','euro','2028/euro.txt','https://raw.githubusercontent.com/openfootball/euro/master/2028/euro.txt','2028',2028,'txt','https://github.com/openfootball/euro','imported',0);
retryService.sports.fixtures=async()=>[];retryService.open.load=async()=>({fixtures:[],warnings:[]});
const retryResult=await retryService.sync('fixtures');
assert.equal(retryResult.outcome,'degraded');assert.match(retryResult.errors[0],/empty.json/);
assert.equal((await retryDb.store.one('SELECT state FROM source_files WHERE id=?','empty-source')).state,'error');
assert.ok((await retryDb.store.one('SELECT last_import FROM source_files WHERE id=?','empty-source')).last_import>1);
assert.equal((await retryDb.store.one('SELECT last_import FROM source_files WHERE id=?','future-placeholder')).last_import,0,'Future tournament placeholders must not consume the current-calendar refresh slot');
retryDb.sqlite.close();
