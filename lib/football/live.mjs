import policy from '../../config/live-sources.json' with {type:'json'};
import {ingestFixtureBatch} from './fixture-ingestion.mjs';
import {LiveScoreAdapter,liveScorePermission} from './livescore.mjs';
import {LIVE, FINAL} from './providers.mjs';
import {digest} from './digest.mjs';
import {providerId} from './consumer.mjs';

const MINUTE=60000;
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function uniqueIncidents(rows){return [...new Map(rows.map(row=>[stable(row),row])).values()];}
export function pollDelay(f,kind='selected'){
 if(kind==='lineups')return FINAL.has(f.status)?86400000:30*MINUTE;
 if(kind==='statistics'||kind==='player-statistics')return 15*MINUTE;
 if(FINAL.has(f.status))return 6*60*MINUTE;
 if(f.status==='HT'||f.status==='PAUSED')return 10*MINUTE;
 return LIVE.has(f.status)?5*MINUTE:30*MINUTE;
}
// A durable snapshot is published only after all relevant table writes complete.
export async function publishLive(service,id){
 const s=service.store,row=await s.one('SELECT payload,updated_at FROM fixtures WHERE id=?',id);if(!row)return;
 const f=JSON.parse(row.payload),details={};
 for(const table of ['fixture_events','fixture_statistics','lineups']){const r=await s.one(`SELECT payload FROM ${table} WHERE fixture_id=?`,id);details[table]=r?JSON.parse(r.payload):[];}
 const appearances=await s.all('SELECT a.player_id,a.payload,p.name FROM football_appearances a JOIN football_players p ON p.id=a.player_id WHERE a.fixture_id=?',id);
 const state={fixture:{id:f.id,provider:f.provider,status:f.status,label:f.label,homeScore:f.homeScore,awayScore:f.awayScore,elapsed:f.elapsed??null},details,players:appearances.map(r=>({id:r.player_id,name:r.name,statistics:JSON.parse(r.payload)}))};
 const revision=await digest(stable(state)),old=await s.cache(`live:state:${id}`);
 if(old?.data.revision===revision)return false;
 await s.putCache(`live:state:${id}`,{...state,revision,updatedAt:s.now()},30*86400000);
 return true;
}
export async function liveSnapshot(s,token){
 const id=providerId(token);
 const own=await s.one('SELECT payload FROM football_cache WHERE id=?',`live:state:${id}`),states=own?[JSON.parse(own.payload)]:[];
 // Linked records of the same match: explicit verified references, or provider matches (kickoff within 15 minutes and
 // both teams compatible; ambiguous matches are never linked). Never a name/date guess. The freshest state wins.
 const aliases=await s.all("SELECT b.fixture_id FROM fixture_identities a JOIN fixture_identities b ON a.canonical_id=b.canonical_id WHERE a.fixture_id=? AND b.fixture_id<>a.fixture_id AND (a.verification IN ('verified-reference','provider-match') OR b.verification IN ('verified-reference','provider-match'))",id);
 for(const alias of aliases){const r=await s.one('SELECT payload FROM football_cache WHERE id=?',`live:state:${alias.fixture_id}`);if(r)states.push({...JSON.parse(r.payload),resolvedFor:id});}
 if(!states.length)return {unavailable:true};
 return states.sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0))[0];
}

// Reuse provider parsers, canonical evidence, quota controls and detail persistence.
// No provider traffic is initiated by the HTTP/SSE read path.
export async function liveTick(service,{cadenceMs=Math.max(60000,(policy.livescore.pollSeconds??60)*1000)}={}){
 const s=service.store,env=service.env;
 const providers=[['api-football','API_FOOTBALL_KEY'],['football-data','FOOTBALL_DATA_KEY']].filter(([,key])=>env[key]);
 const livescore=new LiveScoreAdapter(service.http,env);if(liveScorePermission(env))providers.push(['livescore','MNEMBA_LIVESCORE_ENABLED']);
 if(!providers.length){await s.putCache('live:worker',{state:'not-configured',at:s.now()},86400000);return {state:'not-configured'};}
 const configured=providers.length;for(let i=providers.length-1;i>=0;i--){const b=await s.cache(`live:backoff:${providers[i][0]}`);if(b&&!b.stale)providers.splice(i,1);}
 // One live request per poll interval across every process and revision (LiveScore's local budget is 1,500 a day; several
 // revisions each ticking every minute exhausted it by the afternoon on 2026-11-21).
 if(cadenceMs>0){const cadence=await s.cache('live:tick:providers');if(cadence&&!cadence.stale)return {state:'not-due'};await s.putCache('live:tick:providers',{at:s.now()},cadenceMs-2000);}
 if(configured&&!providers.length)return {state:'backoff'};
 const owner=await s.lock('football-sync',300000);if(!owner)return {state:'busy'};
 const renewal=setInterval(()=>{s.run('UPDATE sync_locks SET expires_at=? WHERE id=? AND owner=?',s.now()+300000,'football-sync',owner).catch(()=>{});},60000);
 const save=service.saveFixtures,detail=service.detailRecord,changed=new Set();
 service.saveFixtures=async rows=>{const updates=[];for(const f of rows){const old=await s.one('SELECT payload FROM fixtures WHERE id=?',f.id);if(!old||stable(JSON.parse(old.payload))!==stable(f)){updates.push(f);changed.add(f.id);}}if(updates.length)await save.call(service,updates,{liveOnly:true});};
 service.detailRecord=async(table,f,rows)=>{if(!Array.isArray(rows))throw Error('Invalid provider detail list');if(table==='fixture_events')rows=uniqueIncidents(rows);const old=await s.one(`SELECT payload FROM ${table} WHERE fixture_id=?`,f.id);if(!old||stable(JSON.parse(old.payload))!==stable(rows)){await detail.call(service,table,f,rows);changed.add(f.id);await service.evidence.claims(f.id,'live-detail',f.provider,f.provider==='livescore'?'https://www.livescore.com':f.provider==='api-football'?'https://v3.football.api-sports.io/':'https://api.football-data.org/v4/',{[table]:rows},{expiresIn:30*86400000});}};
 let task,ingestion;
 try{
  for(const [provider] of providers){const c=await s.cache(`live:discovery:${provider}`);if(!c||c.stale){task={key:`live:discovery:${provider}`,provider,kind:'discovery'};break;}}
  if(!task){
   const rows=await s.all("SELECT payload FROM fixtures WHERE provider IN ('api-football','football-data','livescore') AND starts_at>? AND starts_at<? ORDER BY starts_at DESC LIMIT 100",s.now()-86400000,s.now()+3600000);
   const candidates=[];
   for(const row of rows){const f=JSON.parse(row.payload);if(!providers.some(([p])=>p===f.provider))continue;
    const kinds=FINAL.has(f.status)?(f.provider==='livescore'?['selected','events','lineups']:['selected']):f.provider==='api-football'?['selected','events','lineups','statistics','player-statistics']:f.provider==='livescore'?['selected','events','lineups']:['selected'];
    for(const kind of kinds){const key=`live:poll:${kind}:${f.id}`,c=await s.cache(key);if(!c||c.stale)candidates.push({key,kind,f,due:c?c.updatedAt+pollDelay(f,kind):0});}
   }
   task=candidates.sort((a,b)=>a.due-b.due)[0];
  }
  if(!task)return {state:'idle'};
  if(task.kind==='discovery'){
   // All of today's matches includes scheduled, half-time and newly final games.
   const provider=task.provider,api=provider==='api-football',day=s.day();
   let fixtures;
   if(provider==='livescore'){ingestion=await ingestFixtureBatch(service,'livescore',{resource:'discovery'},counts=>livescore.discovery(counts));if(ingestion.state==='error')throw Error(ingestion.errors.join('; '));fixtures=[];await s.putCache('live:ingestion:livescore',{...ingestion,at:s.now()},86400000);}
   else{const body=await service.provider(provider,api?'fixtures':'matches',api?{date:day}:{dateFrom:day,dateTo:day},'live');
   const rows=api?body.response:body.matches;if(!Array.isArray(rows))throw Error('Invalid provider discovery');
   const {normalizeFixture}=await import('./providers.mjs');
   fixtures=rows.map(r=>normalizeFixture(provider,r));}
   await service.saveFixtures(fixtures);
   for(const f of fixtures)await publishLive(service,f.id);
   await s.putCache(task.key,{count:ingestion?.normalized??fixtures.length},task.provider==='livescore'?5*MINUTE:30*MINUTE);
  }else{
   if(task.f.provider==='livescore')await livescore.match(service,task.f,task.kind);else await service.matchJob(task.kind,task.f.id);
   // Re-read status after a final whistle before choosing the next interval.
   const row=await s.one('SELECT payload FROM fixtures WHERE id=?',task.f.id),f=JSON.parse(row.payload);
   await publishLive(service,f.id);
   await s.putCache(task.key,{at:s.now()},pollDelay(f,task.kind));
  }
  for(const id of changed)await publishLive(service,id);
  const result={state:'success',job:task.kind,provider:task.provider??task.f?.provider,fixtureId:task.f?.id??null,changed:changed.size,...(ingestion?{raw:ingestion.raw,accepted:ingestion.normalized,persisted:ingestion.persisted,rejected:ingestion.rejected}:{}),at:s.now()};await s.putCache('live:worker',result,86400000);return result;
 }catch(error){
  const result={state:error.name==='QuotaError'?'quota-exhausted':'unavailable',job:task?.kind??null,provider:task?.provider??task?.f?.provider,fixtureId:task?.f?.id??null,error:String(error.message).slice(0,300),at:s.now()};
  const delay=error.name==='QuotaError'?Math.max(MINUTE,Date.parse(s.day())+86400000-s.now()):5*MINUTE;
  if(error.name==='QuotaError'&&task)await s.putCache(task.key,result,delay);
  if(error.name==='LiveScoreDetailUnavailable'&&task?.f)await s.putCache(task.key,result,pollDelay(task.f,task.kind));
  else await s.putCache(`live:backoff:${task?.provider??task?.f?.provider}`,result,5*MINUTE);await s.putCache('live:worker',result,86400000);return result;
 }finally{clearInterval(renewal);service.saveFixtures=save;service.detailRecord=detail;await s.unlock('football-sync',owner);}
}
