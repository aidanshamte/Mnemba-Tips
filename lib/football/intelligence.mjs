import {ingestFixtureBatch,recordIngestionHealth} from './fixture-ingestion.mjs';
import {cachedVisualCatalog} from './visuals.mjs';
import {syncOpenLiga,openLigaExport} from './openligadb.mjs';
import {syncFiveDollar} from './fivedollar.mjs';
import {computeAnalysisStates} from './analysis-states.mjs';
import {syncTeamIdentities} from './team-identity.mjs';
import {enrichMedia,mediaFor,enrichNewsMedia} from './media-registry.mjs';
import {matchdayView,shortlistHistory,gradeRecommendations} from './recommendations.mjs';
import {MARKET_REGISTRY} from './market-registry.mjs';
import {coverageMatrix,expandPriority} from './priority-coverage.mjs';
import {publicHistory} from './forecast-history.mjs';
import {analysisCutoff,withMatchState} from './match-state.mjs';
import {competitionLabel} from './competition-catalog.mjs';
import {dayBounds} from './timezone.mjs';
import {syncVideoNews} from './video-news.mjs';
import {importBadges,importPlayers,badgeCatalog} from './public-enrichment.mjs';
import {reconcileGeneratedMirrors} from './mirrors.mjs';
import {savedEstimate} from './estimates.mjs';
import {SourceLifecycle} from './source-lifecycle.mjs';
import {entityContext,articleContext,relatedNews} from './entity-context.mjs';
import {planIdentities,applyIdentities,seasonLabel,privateCompetitions} from './identity-migration.mjs';
import {resolveCompetition,dedupeAcrossProviders,normTeam,teamsMatch} from './competition-identity.mjs';
import {ModelLab} from './model-lab.mjs';
import {globalSearch,refreshSearchIndex} from './search.mjs';
import {matchContext,providerId,routeToken,deriveTable} from './consumer.mjs';
import {FootballService} from './service.mjs';
import {registerSources,SOURCES} from './source-registry.mjs';
import {parseFeed,deduplicate} from './news.mjs';
import {SourceHttp} from './http.mjs';
import {EvidenceStore} from './provenance.mjs';
import {SportsDbAdapter,OpenFootballAdapter,WikidataAdapter} from './adapters.mjs';
import {SnapshotEngine,originalAnalysis} from './temporal.mjs';
import {SocialService} from './social.mjs';
const observationRank=f=>['FT','AET','PEN','FINISHED'].includes(f.status)?3:['1H','2H','HT','ET','BT','P','LIVE','IN_PLAY','PAUSED'].includes(f.status)?2:['PST','CANC','ABD','SUSP','INT','AWD','WO'].includes(f.status)?1:0;
export class IntelligenceService extends FootballService {
 constructor(store,env={},options={}){const http=new SourceHttp(store,env,options);super(store,env,{...options,fetcher:(...args)=>http.fetch(...args)});this.http=http;this.evidence=new EvidenceStore(store);this.sports=new SportsDbAdapter(http);this.open=new OpenFootballAdapter(http,store);this.wiki=new WikidataAdapter(http);this.snapshots=new SnapshotEngine(store,this.evidence);this.social=new SocialService(store,http,this.evidence,env);}
 async initialize(){await registerSources(this.store,this.env);}
 async history(home,away=home,before=this.store.now(),excludeId=null){
  // Only the aliases involved: the two teams, their sibling provider records, and (below) the teams in the rows read.
  // Reading the whole alias table per request held a pooled connection and contributed to pool exhaustion.
  const own=await this.aliasMap([home,away]),wanted=[...new Set([own.get(home)??home,own.get(away)??away])];
  const siblings=await this.store.all(`SELECT provider_id,canonical_id FROM entity_aliases WHERE canonical_id IN (${wanted.map(()=>'?').join(',')})`,...wanted);
  const ids=[...new Set([home,away,...siblings.map(a=>a.provider_id)])].slice(0,100),marks=ids.map(()=>'?').join(',');
  const rows=await this.store.all(`SELECT payload FROM fixtures WHERE (home_team_id IN (${marks}) OR away_team_id IN (${marks})) AND starts_at<? ORDER BY starts_at DESC LIMIT 2000`,...ids,...ids,before);
  const parsed=rows.map(r=>JSON.parse(r.payload)),canonical=await this.aliasMap([home,away,...parsed.flatMap(f=>[f.home?.id,f.away?.id])]);
  const representative=id=>{const key=canonical.get(id)??id;return key===(canonical.get(home)??home)?home:key===(canonical.get(away)??away)?away:key;};
  const deduplicated=await this.deduplicateFixtures(parsed.map(f=>{return{...f,home:{...f.home,id:representative(f.home.id)},away:{...f.away,id:representative(f.away.id)}};}));
  // Unified teams can see the same match from two providers that were never linked: same two clubs, same sides,
  // different providers, kickoffs within 12 hours. Keep one observation (a scored final first) so a result is never
  // counted twice. Two records from the same provider are always distinct matches.
  const rank=f=>(['FT','AET','PEN','FINISHED'].includes(f.status)?2:0)+(f.homeScore!=null?1:0),kept=[];
  for(const f of [...deduplicated].sort((a,b)=>rank(b)-rank(a)||a.startsAt-b.startsAt)){if(kept.some(k=>k.provider!==f.provider&&k.home.id===f.home.id&&k.away.id===f.away.id&&Math.abs(k.startsAt-f.startsAt)<12*3600000))continue;kept.push(f);}
  kept.sort((a,b)=>b.startsAt-a.startsAt);
  const excluded=excludeId?await this.store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',excludeId):null;return kept.filter(f=>f.id!==excludeId&&(!excluded||f.canonicalId!==excluded.canonical_id));
 }
 async reconcileMirrors(){const s=this.store,mirrors=await s.all("SELECT * FROM source_files WHERE repository='deutschland' AND path LIKE 'openliga/%_de.1.txt' AND state='imported'");let matched=0,unresolved=0;
  for(const mirror of mirrors){const primary=await s.one("SELECT * FROM source_files WHERE repository='deutschland' AND path=? AND state='imported'",`${mirror.season}/1-bundesliga.txt`);if(!primary)continue;const rows=await s.all("SELECT f.*,i.canonical_id,i.competition_canonical FROM fixtures f JOIN fixture_identities i ON i.fixture_id=f.id WHERE json_extract(f.payload,'$.sourceUrl')=?",primary.url);const others=await s.all("SELECT * FROM fixtures WHERE json_extract(payload,'$.sourceUrl')=?",mirror.url);for(const other of others){const candidates=rows.filter(r=>r.home_team_id===other.home_team_id&&r.away_team_id===other.away_team_id);if(candidates.length!==1){unresolved++;await this.evidence.queue('fixture-match',other.id,mirror.url,{required:'Participant alias verification before merging mirror record',canonicalSource:primary.url});continue;}const target=candidates[0];await s.run("UPDATE fixture_identities SET canonical_id=?,competition_canonical=?,verification='verified-reference' WHERE fixture_id=?",target.canonical_id,target.competition_canonical,other.id);await this.evidence.conflicts(target.canonical_id);matched++;}}
  return{matched,unresolved,note:'Exact unique home/away pairs in the same documented Bundesliga season. Different kickoff claims are retained.'};
 }
 async saveCompetition(c,authoritative=true){const old=await this.store.one('SELECT payload FROM competitions WHERE id=?',c.id);if(old&&c.country&&!JSON.parse(old.payload).country)authoritative=true;const resolved=await super.saveCompetition(c,authoritative);if(c.country?.confederation){const code=c.country.confederation;await this.store.upsert('confederations',{id:code,name:code,region:c.country.continent??'International',source_url:'https://www.fifa.com/associations'});await this.store.run('INSERT OR IGNORE INTO country_confederations(country_id,confederation_id,source_url) VALUES(?,?,?)',c.country.id,code,c.country.sourceUrl??c.sourceUrl??'https://github.com/openfootball');}return resolved;}
 async saveFixtures(fixtures,options={}){for(const f of fixtures){if(f.provider!=='openfootball'||!f.round)continue;const previous=await this.store.all('SELECT id,external_id,payload FROM fixtures WHERE competition_id=? AND season_id=? AND home_team_id=? AND away_team_id=?',f.competition.id,f.seasonId,f.home.id,f.away.id);let same=previous.filter(r=>JSON.parse(r.payload).round===f.round);if(!same.length){const annotated=await this.store.all('SELECT id,external_id,payload FROM fixtures WHERE competition_id=? AND season_id=? AND home_team_id=?',f.competition.id,f.seasonId,f.home.id);same=annotated.filter(r=>{const old=JSON.parse(r.payload),name=old.away.name.replace(/\s+\[(?:postponed|cancelled|canceled)\]$/i,'');return name!==old.away.name&&name===f.away.name&&old.round===f.round&&old.sourceUrl===f.sourceUrl;});}if(same.length===1){f.id=same[0].id;f.externalId=same[0].external_id;}}await super.saveFixtures(fixtures,options);for(const f of fixtures)await this.evidence.observeFixture(f);if(!options.liveOnly){await new ModelLab(this).grade();await gradeRecommendations(this);}await this.store.run("DELETE FROM football_cache WHERE id LIKE 'matchday:%'");}
 async savePlayer(provider,p,teamId,stat){await super.savePlayer(provider,p,teamId,stat);const row=await this.store.one('SELECT payload FROM football_players WHERE id=?',`${provider}:${p.id}`);if(!row)return;const player=JSON.parse(row.payload),source=SOURCES.find(s=>s.id===provider);if(!source)return;await this.evidence.entity('player',player.id,player.name,provider,{sourceUrl:stat.sourceUrl??source.apiUrl});await this.evidence.claims(player.id,'player',provider,stat.sourceUrl??source.apiUrl,{name:player.name,position:player.position,teamId:player.teamId},{verification:'sourced'});}
 async job(key,force=false){if(key!=='news')return super.job(key,force);const cached=await this.store.cache('job:news');if(!force&&cached&&!cached.stale)return{status:'cached',job:key};const results=await this.sync('news');await this.store.putCache('job:news',results,3600000);return{status:'success',job:key,results};}
 async detailRecord(table,f,data){await super.detailRecord(table,f,data);await this.evidence.claims(f.id,'fixture',f.provider,f.sourceUrl??SOURCES.find(s=>s.id===f.provider).baseUrl,{[table==='fixture_events'?'events':table]:data});if(table==='lineups'&&data.length&&this.store.now()<f.startsAt)await this.snapshots.capture(f,'official-lineup',this.store.now());}
 async news(){const lifecycle=new SourceLifecycle(this),results=[];for(const source of SOURCES.filter(v=>v.category==='news')){try{results.push(await lifecycle.run(source.id));}catch(e){results.push({source:source.id,error:e.message});}}return results;}

 async sync(kind='fixtures',fileId=''){
  const s=this.store,owner=await s.lock('football-sync',600000);if(!owner)return{skipped:'Another synchronization is running'};
  const started=s.now();this.recordCounts={inserted:0,updated:0,duplicate:0,failed:0};s.writeStats=this.recordCounts;
  try{
   let result={};
   if(kind==='fixtures'||kind==='results'){
    const providers=[];
    if(kind==='fixtures'){
     if(this.env.API_FOOTBALL_KEY||this.env.FOOTBALL_DATA_KEY){for(const job of ['live','today','upcoming']){const result=await this.fixtureList(job);providers.push(...result.providers);}}
     else for(const [provider,key] of [['api-football','API_FOOTBALL_KEY'],['football-data','FOOTBALL_DATA_KEY']])providers.push({provider,attempted:false,state:'not-configured',reason:`Missing ${key}`});
    }
    for(const offset of (kind==='results'?[-1,0]:[0,1,2,3,4,5,6])){
     const day=new Date(s.now()+offset*86400000).toISOString().slice(0,10),key=`fixture-horizon:thesportsdb:${day}`,cached=offset>=2?await s.cache(key):null;
     if(cached&&!cached.stale){providers.push({provider:'thesportsdb',request:{day},attempted:false,state:'cached',confirmed:cached.data.count});continue;}
     const report=await ingestFixtureBatch(this,'thesportsdb',{day},counts=>this.sports.fixtures(day,counts));providers.push(report);
     if(offset>=2&&report.state==='success')await s.putCache(key,{count:report.persisted},6*3600000);
    }
    if(kind==='fixtures'){
     const entry=await s.one("SELECT * FROM source_files WHERE year>=? AND year<=? AND ((state='imported' AND last_import<?) OR (state='error' AND fixture_count>0 AND last_import<?)) ORDER BY last_import LIMIT 1",new Date(s.now()).getUTCFullYear()-1,new Date(s.now()).getUTCFullYear(),s.now()-1800000,s.now()-86400000);
     if(entry){const report=await ingestFixtureBatch(this,'openfootball',{file:entry.path,season:entry.season},async counts=>{const data=await this.open.load(entry);counts.raw=data.rawCount??data.fixtures.length;counts.rejected=data.rejectedCount??0;counts.rejectionReasons=[...new Set(data.warnings??[])].slice(0,5);if(!data.fixtures.length)throw Error('Source file returned zero verified dated fixtures');return data.fixtures;});providers.push(report);
      if(report.state==='error')await s.run("UPDATE source_files SET state='error',last_import=?,error=? WHERE id=?",s.now(),report.errors.join('; '),entry.id);
      else await s.run("UPDATE source_files SET state='imported',last_import=?,fixture_count=?,error=? WHERE id=?",s.now(),report.normalized,report.rejected?`${report.rejected} fixture candidates rejected; unverified dates or identities`:null,entry.id);
     }else providers.push({provider:'openfootball',attempted:false,state:'not-due',reason:'No eligible source file is due'});
     const liga=await s.one("SELECT last_success,state,error FROM update_jobs WHERE id='openligadb'");providers.push({provider:'openligadb',attempted:false,state:'separate-job',lastSuccess:liga?.last_success??null,reason:'Refreshed by the existing three-hour OpenLigaDB job'});
     for(const provider of ['livescore','highlightly','sportmonks']){const source=await s.one('SELECT enabled,disabled_reason FROM source_registry WHERE id=?',provider);providers.push({provider,attempted:false,state:source?.enabled?'separate-job':'disabled',reason:source?.disabled_reason??'Separate live worker; not a base-fixture gate'});}
    }
    const health=await recordIngestionHealth(s,kind,providers);
    result={fixtures:health.persisted,providers,health,errors:health.errors};
   }else if(kind==='news')result=await this.news();
   else if(kind==='documents'){result=[];const lifecycle=new SourceLifecycle(this);for(const source of SOURCES.filter(v=>v.category==='reviewed-document'))try{result.push(await lifecycle.run(source.id));}catch(e){result.push({source:source.id,error:e.message});}}
   else if(kind==='archive'){result=await this.http.json('archive','https://archive.org/wayback/available?url=https%3A%2F%2Fgithub.com%2Fopenfootball%2Ffootball.json');await s.putCache('archive-availability',result,86400000);}
   else if(kind==='catalog'){const rows=await this.sports.catalog();for(const c of rows)await this.saveCompetition(c,false);result={competitions:rows.length};
   }else if(kind==='discover'){const repos=await this.open.repositories(),errors=[];let files=0;for(const repo of repos){try{files+=(await this.open.discover(repo.name,repo.default_branch)).length;}catch(e){errors.push(`${repo.name}: ${e.message}`);}}result={files,errors};
   }else if(kind==='history'){
    const entries=fileId?await s.all('SELECT * FROM source_files WHERE id=?',fileId):await s.all("SELECT * FROM source_files WHERE state='pending' AND year<=? ORDER BY year DESC,CASE WHEN path LIKE '%en.1.json' OR path LIKE '%sa.1%' OR path LIKE '%sa1%' OR path LIKE '%cl.txt' OR path LIKE '%el.txt' OR path LIKE '%conf.txt' OR path LIKE '%libertadores%' OR path LIKE '%sudamericana%' THEN 0 ELSE 1 END,repository,path LIMIT 3",new Date(s.now()).getUTCFullYear()),results=[];
    for(const entry of entries){try{const data=await this.open.load(entry);if(!data.fixtures.length)throw new Error('Historical file returned zero valid fixtures');await this.saveFixtures(data.fixtures);await s.run("UPDATE source_files SET state='imported',last_import=?,fixture_count=?,error=? WHERE id=?",s.now(),data.fixtures.length,data.warnings.join('; ').slice(0,1000)||null,entry.id);results.push({file:entry.path,fixtures:data.fixtures.length});}catch(e){await s.run("UPDATE source_files SET state='error',error=? WHERE id=?",e.message,entry.id);results.push({file:entry.path,error:e.message});}}result={files:results};
   }else if(kind==='reconcile'){
    const countries=await this.wiki.countries();for(const c of countries){await s.upsert('countries',{id:`wikidata:${c.id}`,provider:'wikidata',external_id:c.id,name:c.name,code:c.code,continent:c.continent,payload:JSON.stringify(c),updated_at:s.now()});const entity=await this.evidence.entity('country',`wikidata:${c.id}`,c.name,'wikidata',{wikidataId:c.id,sourceUrl:`https://www.wikidata.org/wiki/${c.id}`});await this.evidence.claims(entity,'country','wikidata',`https://www.wikidata.org/wiki/${c.id}`,c);}result={countries:countries.length};
   }else if(kind==='identities'){
    const rows=await s.all("SELECT t.id,t.name FROM football_teams t LEFT JOIN entity_aliases a ON a.provider_id=t.id WHERE a.verified IS NULL OR a.verified=0 ORDER BY t.updated_at DESC LIMIT 3");let candidates=0;for(const row of rows){const matches=await this.wiki.search(row.name);for(const item of await this.wiki.entities(matches.map(m=>m.id))){if(!/football|soccer/i.test(item.description))continue;const canonical=await this.evidence.entity('team',`wikidata:${item.id}`,item.name,'wikidata',{...item,wikidataId:item.id});await this.evidence.claims(canonical,'team','wikidata',item.sourceUrl,item);await this.evidence.queue('entity-match',canonical,item.sourceUrl,{providerId:row.id,canonicalId:canonical,name:row.name,candidate:item.name});await this.social.registerFromWikidata(canonical,item);candidates++;}}result={candidates};
   }else if(kind==='entities'){
    const comps=await s.all("SELECT c.external_id FROM competitions c JOIN fixtures f ON f.competition_id=c.id WHERE c.provider='thesportsdb' GROUP BY c.external_id ORDER BY MAX(f.starts_at) DESC LIMIT 2");let teams=0,players=0;
    for(const c of comps){for(const t of await this.sports.teams(c.external_id)){await this.saveTeam(t);const id=await this.evidence.entity('team',t.id,t.name,'thesportsdb',t);await this.evidence.claims(id,'team','thesportsdb',t.sourceUrl,t);teams++;}}
    const selected=await s.all("SELECT external_id FROM football_teams WHERE provider='thesportsdb' ORDER BY updated_at DESC LIMIT 2");for(const t of selected)for(const p of await this.sports.players(t.external_id)){await s.upsert('football_players',{id:p.id,provider:p.provider,external_id:p.externalId,team_id:p.teamId,name:p.name,payload:JSON.stringify(p),updated_at:s.now()});const canonical=await this.evidence.entity('player',p.id,p.name,p.provider,p);await this.evidence.claims(canonical,'player',p.provider,p.sourceUrl,p);players++;}result={teams,players};
   }else if(kind==='rosters'){const teams=await s.all("SELECT id FROM football_teams WHERE json_extract(payload,'$.wikidataId') IS NOT NULL ORDER BY updated_at DESC LIMIT 2");result={teams:[]};for(const t of teams)try{result.teams.push(await this.roster(t.id));}catch(e){result.teams.push({teamId:t.id,error:e.message});}}
   else if(kind==='media-news')result=await enrichNewsMedia(this);
   else if(kind==='media')result=await enrichMedia(this);
   else if(kind==='video-news')result=await syncVideoNews(this);
   else if(kind==='badges')result=await importBadges(this);
   else if(kind==='players')result=await importPlayers(this);
   else if(kind==='model-rollback')result=await new ModelLab(this).rollback();
   else if(kind==='openligadb')result=await syncOpenLiga(this);
   else if(kind==='team-identities'){
    // Noncritical identity enrichment: time-boxed (40 s, never within 60 s of the run deadline).
    result=await syncTeamIdentities(this,{stopAt:Math.min(s.now()+40000,(this.runDeadline??Infinity)-60000)});
   }
   else if(kind==='analysis-states'){
    // Time-boxed (45 s, never within 60 s of the run deadline), stalest first; resumes on the next run.
    const stopAt=Math.min(s.now()+45000,(this.runDeadline??Infinity)-60000);
    result=await computeAnalysisStates(this,{stopAt,visible:async rows=>{const hidden=await privateCompetitions(s,rows.map(f=>f.competition?.id));return rows.filter(f=>!hidden.has(f.competition?.id));}});
   }
   else if(kind==='fivedollar')result=await syncFiveDollar(this,{mode:'core'});
   else if(kind==='fivedollar-details')result=await syncFiveDollar(this,{mode:'details'});
   else if(kind==='priority-import')result=await expandPriority(this);
   else if(kind==='models')result=await new ModelLab(this).update({stopAt:this.stageDeadline});
   else if(kind==='search-index')result=await refreshSearchIndex(s,true);
   // Canonical competitions: evidence-checked plan applied idempotently; uncertain merges go to the review queue.
   else if(kind==='competition-identities'){const plan=await planIdentities(s);result={...plan.stats,changes:await applyIdentities(s,plan)};}
   else if(kind==='mirrors')result={legacy:await this.reconcileMirrors(),generated:await reconcileGeneratedMirrors(this)};
   else if(kind==='backfill'){const rows=await s.all("SELECT f.payload FROM fixtures f LEFT JOIN field_claims c ON c.entity_id=f.id AND c.field='fixture' WHERE c.id IS NULL LIMIT 500");for(const r of rows)await this.evidence.observeFixture(JSON.parse(r.payload));result={observedNow:rows.length,note:'Historical records observed now; prior snapshots are never backfilled.'};}
   else if(kind==='snapshots')result=await this.snapshots.due();
   else if(kind==='calibration')result=await this.snapshots.calibration();
   else if(kind==='social')result=await this.social.youtube();
   else if(kind==='retention'){await this.evidence.retention();result={complete:true};}
   else throw new Error('Unknown intelligence job');
   await s.run("DELETE FROM football_cache WHERE id='search-index'");
   const failures=[...(result.error>0?[`${result.error} fixture analysis attempts failed; per-fixture outcomes retained`]:[]),...(result.errors??[]),...(result.files??[]).filter(r=>r.error).map(r=>r.error),...(Array.isArray(result.teams)?result.teams.filter(r=>r.error).map(r=>r.error):[])];if(Array.isArray(result))for(const row of result)if(row.error)failures.push(row.error);const empty=['fixtures','results'].includes(kind)&&result.fixtures===0&&!failures.length&&!(result.health?.rejected>0);/* A stage that stopped at its time limit, request budget or circuit breaker (provider) or before its deadline (models) did not complete: record 'incomplete', not 'success', and keep last_success unchanged. 'incomplete' does not fail the run. */const incomplete=(typeof result.deferred==='string'&&result.deferred.length>0)||result.stoppedEarly===true;/* A local request budget or source backoff is a deliberate deferral, not a failure: record 'incomplete'. */const deferredOnly=failures.length>0&&failures.every(f=>/local free-request budget exhausted|backoff active|retry deferred/i.test(String(f)));const outcome=empty?'empty':result.health?.state==='degraded'?'degraded':failures.length&&!deferredOnly?'partial':deferredOnly?'incomplete':result.state==='disabled'?'disabled':incomplete?'incomplete':'success';const previousJob=await s.one('SELECT last_success FROM update_jobs WHERE id=?',kind);const interval=['history','discover','reconcile','entities','identities','competition-identities','rosters','archive','retention','calibration','search-index'].includes(kind)?86400000:['news','social','video-news'].includes(kind)?3600000:1800000;const counts={...this.recordCounts,unchanged:this.recordCounts.duplicate,skipped:0,sourceErrors:failures.length,scope:'normalized data rows; excludes cache, provenance and job metadata'};result=Array.isArray(result)?{sources:result,outcome,counts}:{...result,outcome,counts};if(kind==='news'&&outcome==='success')await s.putCache('job:news',{status:'success',result:{sources:result.sources,outcome,counts}},4*3600000);/* freshness marker read by view=news; three-hourly cadence plus margin */
   await s.upsert('update_jobs',{id:kind,interval_ms:interval,last_attempt:started,last_success:outcome==='success'?s.now():previousJob?.last_success??null,next_run:s.now()+((kind==='models'&&!result.complete||kind==='media'&&result.remaining>0)?60000:interval),state:outcome,error:empty?'No valid fixtures returned by configured sources':result.health?.state==='degraded'?result.health.reasons.join('; '):failures.join('; ')||null,payload:JSON.stringify(result)});return result;
  }catch(e){await s.upsert('update_jobs',{id:kind,interval_ms:1800000,last_attempt:started,last_success:(await s.one('SELECT last_success FROM update_jobs WHERE id=?',kind))?.last_success??null,next_run:s.now()+1800000,state:'error',error:e.message,payload:'{}'});throw e;}finally{s.writeStats=null;await s.unlock('football-sync',owner);}
 }
 async roster(teamId){const row=await this.store.one('SELECT payload FROM football_teams WHERE id=?',teamId);if(!row)return{state:'unavailable',reason:'Unknown club'};const team=JSON.parse(row.payload);if(!team.wikidataId)return{state:'unavailable',reason:'A corroborated Wikidata club identity is needed'};const records=await this.wiki.squad(team.wikidataId);for(const r of records){const id=`wikidata:${r.id}`,existing=await this.store.one('SELECT payload,team_id FROM football_players WHERE id=?',id),p={...JSON.parse(existing?.payload??'{}'),id,provider:'wikidata',externalId:r.id,name:r.name,teamId:existing?.team_id??teamId,position:r.positions.join(', ')||null,minutes:JSON.parse(existing?.payload??'{}').minutes??null,rating:JSON.parse(existing?.payload??'{}').rating??null,availability:JSON.parse(existing?.payload??'{}').availability??'unknown',sourceUrl:r.sourceUrl,membershipNote:'Wikidata membership claim; current squad not independently verified'};await this.store.upsert('football_players',{id,provider:p.provider,external_id:p.externalId,team_id:p.teamId,name:p.name,payload:JSON.stringify(p),updated_at:this.store.now()});await this.evidence.entity('player',id,p.name,'wikidata',{wikidataId:r.id});await this.evidence.claims(id,'player','wikidata',r.sourceUrl,{identity:{name:p.name,positions:r.positions},['membership:'+teamId]:{teamId,teamName:team.name,start:r.membershipStart,sourceUrl:r.sourceUrl,note:p.membershipNote}},{confidence:.65,verification:'membership-claim',expiresIn:30*86400000});}return{state:records.length?'sourced':'empty',team:team.name,players:records.length,note:'Membership claims are not confirmed matchday squads.'};}
 async enrichMatch(id){
  id=providerId(id);const row=await this.store.one('SELECT payload FROM fixtures WHERE id=?',id);if(!row)throw new Error('Unknown fixture');const f=JSON.parse(row.payload),outcomes=[];
  if(f.provider==='openfootball'){const entry=await this.store.one('SELECT * FROM source_files WHERE url=?',f.sourceUrl);if(entry){const previous=await this.store.one("SELECT * FROM source_files WHERE repository=? AND year<? AND state='pending' AND path LIKE ? ORDER BY year DESC LIMIT 1",entry.repository,entry.year,'%/'+entry.path.split('/').at(-1));if(previous)outcomes.push(await this.sync('history',previous.id));else outcomes.push({state:'cached',reason:'Available matching historical files already imported.'});}}
  else if(f.provider==='statsbomb'||(f.provider==='api-football'&&this.env.API_FOOTBALL_KEY)){for(const kind of ['lineups','events','statistics']){try{outcomes.push({kind,result:await this.matchJob(kind,id)});}catch(e){outcomes.push({kind,error:e.message});}}}
  else outcomes.push({state:'unavailable',reason:'No configured detail adapter for this fixture identity.'});
  const owner=await this.store.lock('football-sync',120000);if(owner){try{for(const t of [f.home,f.away])try{outcomes.push(await this.roster(t.id));}catch(e){outcomes.push({team:t.name,error:e.message});}}finally{await this.store.unlock('football-sync',owner);}}else outcomes.push({state:'deferred',reason:'Another synchronization holds the roster lease'});return{outcomes,context:await matchContext(this,id)};
 }
 async rawOverview(){const s=this.store,now=s.now(),day=Date.parse(new Date(now).toISOString().slice(0,10));const unpack=rows=>rows.map(r=>({...JSON.parse(r.payload),updatedAt:r.updated_at}));return{today:unpack(await s.all('SELECT payload,updated_at FROM fixtures WHERE starts_at>=? AND starts_at<? ORDER BY starts_at LIMIT 100',day,day+86400000)),upcoming:unpack(await s.all("SELECT payload,updated_at FROM fixtures WHERE starts_at>? AND status IN ('NS','TIMED','SCHEDULED') ORDER BY starts_at LIMIT 80",now)),results:unpack(await s.all("SELECT payload,updated_at FROM fixtures WHERE status IN ('FT','FINISHED','AET','PEN') ORDER BY starts_at DESC LIMIT 40")),counts:await s.one('SELECT (SELECT COUNT(*) FROM competitions) competitions,(SELECT COUNT(*) FROM football_teams) teams,(SELECT COUNT(*) FROM football_players) players,(SELECT COUNT(*) FROM fixtures) fixtures,(SELECT COUNT(*) FROM news_articles) news,(SELECT COUNT(*) FROM field_claims) claims,(SELECT COUNT(*) FROM source_files WHERE state=\'pending\') pendingFiles'),news:(await super.read(new URLSearchParams({view:'news'}))).articles.slice(0,18),updatedAt:now};}
 async aliasMap(ids){const out=new Map(),list=[...new Set(ids)].filter(Boolean);for(let i=0;i<list.length;i+=500){const c=list.slice(i,i+500);for(const r of await this.store.all(`SELECT provider_id,canonical_id FROM entity_aliases WHERE provider_id IN (${c.map(()=>'?').join(',')})`,...c))out.set(r.provider_id,r.canonical_id);}return out;}
 // Identities of the fixtures in hand only (previously the whole fixture_identities table on every request).
 async deduplicateFixtures(fixtures){const index=new Map(),list=[...new Set(fixtures.map(f=>f.id))];for(let i=0;i<list.length;i+=500){const c=list.slice(i,i+500);for(const r of await this.store.all(`SELECT fixture_id,canonical_id FROM fixture_identities WHERE fixture_id IN (${c.map(()=>'?').join(',')})`,...c))index.set(r.fixture_id,r.canonical_id);}const groups=new Map();for(const f of fixtures){const canonicalId=index.get(f.id)??f.id;const claim={id:f.id,provider:f.provider,startsAt:f.startsAt,status:f.status,homeScore:f.homeScore,awayScore:f.awayScore,sourceUrl:f.sourceUrl};if(groups.has(canonicalId)){const cur=groups.get(canonicalId);cur.sourceClaims.push(claim);/* The most advanced verified observation represents the match: a provider frozen at "2H 90" never hides another provider's final; among live records the later minute wins. */if(observationRank(f)>observationRank(cur)||(observationRank(f)===observationRank(cur)&&observationRank(f)===2&&(f.elapsed??0)>(cur.elapsed??0)))groups.set(canonicalId,{...f,canonicalId,sourceClaims:cur.sourceClaims});}else groups.set(canonicalId,{...f,canonicalId,sourceClaims:[claim]});}const conflicts=await this.store.all("SELECT entity_id,field FROM evidence_conflicts WHERE status='open'");return [...groups.values()].map(f=>({...withMatchState(f,this.store.now()),conflictFields:conflicts.filter(c=>c.entity_id===f.canonicalId).map(c=>c.field),hasConflict:conflicts.some(c=>c.entity_id===f.canonicalId)}));}
 async publicInsights(){const cached=await this.store.cache('public-insights-v3');if(cached&&!cached.stale)return cached.data;const data=await this.overview(),seen=new Set(),candidates=data.upcoming.filter(f=>{const label=competitionLabel(f.competition);if(seen.has(label))return false;seen.add(label);return true;}).slice(0,12),eligible=[],fallback=[];for(const f of candidates){const analysis=await savedEstimate(this,f,await this.history(f.home.id,f.away.id,analysisCutoff(f,this.store.now()),f.id));const entry={fixture:f,analysis};if(analysis.probabilities)eligible.push(entry);else fallback.push(entry);if(eligible.length>=3)break;}const result={insights:[...eligible,...fallback].slice(0,3)};await this.store.putCache('public-insights-v3',result,600000);return result;}
 async overview(zone='UTC'){const data=await this.rawOverview();const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(this.store.now())),bounds=dayBounds(day,zone);data.today=(await this.store.all("SELECT payload FROM fixtures WHERE (COALESCE(json_extract(payload,'$.kickoffPrecision'),'instant')!='date' AND starts_at>=? AND starts_at<?) OR (json_extract(payload,'$.kickoffPrecision')='date' AND starts_at>=? AND starts_at<?) ORDER BY starts_at LIMIT 500",bounds.start,bounds.end,Date.parse(day),Date.parse(day)+86400000)).map(r=>JSON.parse(r.payload));for(const key of ['today','upcoming','results'])data[key]=await this.deduplicateFixtures(data[key]);data.counts.fixtureRecords=data.counts.fixtures;data.counts.fixtures=(await this.store.one('SELECT COUNT(DISTINCT COALESCE(i.canonical_id,f.id)) n FROM fixtures f LEFT JOIN fixture_identities i ON i.fixture_id=f.id')).n;data.serverTime=this.store.now();data.updatedAt=(await this.store.one('SELECT MAX(updated_at) value FROM fixtures')).value??this.store.now();return data;}
 // Canonical competition page: a canonical id or any old provider competition id resolves to the same aggregate.
 async competitionView(id){
  const s=this.store,isCanonical=String(id).startsWith('competition:');
  const canonicalId=isCanonical?id:(await s.one("SELECT canonical_id FROM entity_aliases WHERE provider_id=? AND verified=1 AND canonical_id LIKE 'competition:%'",id))?.canonical_id??null;
  const memberIds=canonicalId?(await s.all('SELECT provider_id FROM entity_aliases WHERE canonical_id=? AND verified=1',canonicalId)).map(r=>r.provider_id):[id];
  if(!memberIds.length)return{competition:null,fixtures:[]};
  const marks=memberIds.map(()=>'?').join(','),members=await s.all(`SELECT id,provider,external_id,name,type,payload FROM competitions WHERE id IN (${marks})`,...memberIds);
  if(!members.length)return{competition:null,fixtures:[]};
  const summary=canonicalId?JSON.parse((await s.one('SELECT payload FROM canonical_entities WHERE id=?',canonicalId))?.payload??'null'):null;
  const structure=new Map(members.map(m=>{const p=JSON.parse(m.payload),r=resolveCompetition({id:m.id,provider:m.provider,externalId:m.external_id,name:m.name,type:m.type,country:p.country??null,gender:p.gender??null});return[m.id,{season:r.season,stage:r.stage??(r.group?'Group stage':null),group:r.group,identity:r}];}));
  const anchor=structure.get(members[0].id).identity,rows=(await s.all(`SELECT payload FROM fixtures WHERE competition_id IN (${marks}) ORDER BY starts_at DESC LIMIT 1500`,...memberIds)).map(r=>JSON.parse(r.payload));
  const seasonOf=new Map((await s.all(`SELECT id,year,payload FROM seasons WHERE competition_id IN (${marks})`,...memberIds)).map(r=>{const p=JSON.parse(r.payload);return[r.id,seasonLabel([p.label,p.providerSeason].find(v=>/^(19|20)\d{2}/.test(String(v??'')))??r.year)];}));
  const fixtures=dedupeAcrossProviders(await this.deduplicateFixtures(rows)).map(f=>{const st=structure.get(f.competition?.id)??{};return{...f,season:st.season?seasonLabel(st.season):seasonOf.get(f.seasonId)??null,stage:st.stage??null,group:st.group??null};});
  const names=[];for(const n of fixtures.flatMap(f=>[normTeam(f.home?.name),normTeam(f.away?.name)]))if(!names.some(x=>teamsMatch(x,n)))names.push(n);
  // Reconstructed from recorded results only; labelled as such, never presented as official standings.
  const league=fixtures.filter(f=>!f.group&&!f.stage),latest=league.map(f=>f.season).filter(Boolean).sort().at(-1),table=latest?deriveTable(league.filter(f=>f.season===latest),s.now()):[];
  return{canonicalId,legacyId:canonicalId&&canonicalId!==id?id:null,competition:{id:canonicalId??id,name:summary?.name??anchor.name,country:summary?.country??anchor.country,governingBody:summary?.governingBody??anchor.governingBody,continent:summary?.continent??anchor.continent,type:summary?.type??anchor.type,tier:summary?.tier??anchor.tier,gender:summary?.gender??anchor.gender,age:summary?.age??anchor.age,providerIds:memberIds,aliases:summary?.aliases??members.map(m=>m.name),seasons:[...new Set(fixtures.map(f=>f.season).filter(Boolean))].sort().reverse(),stages:summary?.stages??[],emblemId:members[0].id},
   fixtures,teams:names.length,standings:await this.providerStandings(marks,memberIds)??{season:latest??null,label:'Reconstructed from recorded results; not official standings',rows:table}};
 }
 // A licensed provider's league table, when one is stored for a member record, is preferred over reconstruction.
 async providerStandings(marks,memberIds){
  const row=await this.store.one(`SELECT payload FROM standings WHERE label='Provider standings' AND season_id IN (SELECT id FROM seasons WHERE competition_id IN (${marks})) ORDER BY updated_at DESC LIMIT 1`,...memberIds);if(!row)return null;
  const p=JSON.parse(row.payload);
  return{season:seasonLabel(p.season),source:'provider',label:`League table from ${p.attribution??'the data provider'}${p.round?` after round ${p.round}`:''}`,rows:p.rows.map(r=>({team:r.team,position:r.position,played:r.played,wins:r.won,draws:r.drawn,losses:r.lost,goalsFor:r.goalsFor,goalsAgainst:r.goalsAgainst,goalDifference:r.goalDifference,points:r.points}))};
 }
 async read(params){const view=params.get('view');if(params.has('id'))params.set('id',providerId(params.get('id')));
 if(view==='live-health')return {worker:(await this.store.cache('live:worker'))?.data??null,ingestion:(await this.store.cache('live:ingestion:livescore'))?.data??null,inventory:await this.store.one("SELECT COUNT(*) records,MIN(starts_at) first_kickoff,MAX(starts_at) last_kickoff FROM fixtures WHERE provider='livescore'")};
 if(view==='ingestion-health')return (await this.store.cache('fixture-ingestion-health'))?.data??{state:'unavailable'};
 if(view==='matchday')return matchdayView(this,params);
 if(view==='shortlists')return shortlistHistory(this,params);
 if(view==='markets')return {markets:MARKET_REGISTRY};
 if(view==='openligadb-export')return openLigaExport(this.store);
 if(view==='coverage')return coverageMatrix(this);
 if(view==='insights')return this.publicInsights();
 if(view==='visuals')return cachedVisualCatalog(this.store);
 if(view==='media')return {media:await mediaFor(this.store,(params.get('ids')??'').split(',').filter(Boolean).slice(0,30))};
 if(view==='badges')return badgeCatalog(this.store);
 if(view==='competition')return this.competitionView(params.get('id'));
 // Related reporting is a labelled text mention of either club, never a confirmed match impact.
 if(view==='match-context'){const context=await matchContext(this,params.get('id'));if(context.unavailable)return context;return{...context,news:await relatedNews(this.store,[context.fixture.home.name,context.fixture.away.name]).catch(()=>[])};}
 if(view==='article')return articleContext(this.store,params.get('id'));
 if(view==='prediction-history')return publicHistory(this,params);
 if(view==='performance')return new ModelLab(this).performance();
 if(view==='global-search')return globalSearch(this.store,params);
 if(view==='fixtures'||!view){const data=await super.read(params);data.fixtures=await this.deduplicateFixtures(data.fixtures);return data;}if(view==='analysis'){const row=await this.store.one('SELECT payload FROM fixtures WHERE id=?',params.get('id'));if(!row)return{unavailable:true};const f=JSON.parse(row.payload),history=await this.history(f.home.id,f.away.id,analysisCutoff(f,this.store.now()),f.id);return{fixture:withMatchState(f,this.store.now()),analysis:await savedEstimate(this,f,history),conflicts:await this.store.all("SELECT c.* FROM evidence_conflicts c JOIN fixture_identities f ON f.canonical_id=c.entity_id WHERE f.fixture_id=? AND c.status='open'",f.id)};}if(view==='files')return{files:await this.store.all('SELECT * FROM source_files ORDER BY year DESC,repository,path LIMIT 10000')};if(view==='overview')return this.overview(params.get('timezone')??'UTC');if(view==='sources')return{sources:(await this.store.all('SELECT * FROM source_registry ORDER BY enabled DESC,name')).map(r=>({...JSON.parse(r.payload),...r,payload:undefined})),jobs:await this.store.all('SELECT * FROM update_jobs'),conflicts:await this.store.all("SELECT * FROM evidence_conflicts WHERE status='open'"),queue:await this.store.all("SELECT * FROM verification_queue WHERE status='pending' LIMIT 100"),budget:await this.store.budget()};if(view==='evidence')return{claims:await this.store.all('SELECT c.* FROM field_claims c WHERE c.entity_id=? OR c.entity_id IN (SELECT fixture_id FROM fixture_identities WHERE canonical_id=(SELECT canonical_id FROM fixture_identities WHERE fixture_id=?)) ORDER BY c.retrieved_at DESC LIMIT 100',params.get('id'),params.get('id')),snapshots:await this.store.all('SELECT * FROM prematch_snapshots WHERE fixture_id=? ORDER BY as_of',params.get('id'))};if(view==='social')return{accounts:await this.store.all('SELECT * FROM social_accounts'),posts:await this.store.all('SELECT * FROM social_evidence ORDER BY published_at DESC LIMIT 100')};if(view==='entity')return entityContext(this,params.get('id'));return super.read(params);}
}
