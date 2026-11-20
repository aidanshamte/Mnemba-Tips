import {ingestFixtureBatch,recordIngestionHealth} from './fixture-ingestion.mjs';
const BASE='https://api.openligadb.de';
export const OPENLIGA_LICENSE='https://opendatacommons.org/licenses/odbl/1-0/';
export function normalizeOpenLiga(raw,shortcut,year){
 if(!['bl1','bl2'].includes(shortcut)||raw.leagueShortcut!==shortcut||raw.leagueSeason!==year)throw Error('OpenLigaDB league/season mismatch');
 if(!Number.isInteger(raw.matchID)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(raw.matchDateTimeUTC??''))throw Error('OpenLigaDB requires an explicit UTC kickoff and match ID');
 const startsAt=Date.parse(raw.matchDateTimeUTC);if(!Number.isFinite(startsAt))throw Error('Invalid UTC kickoff');
 const team=t=>{if(!Number.isInteger(t?.teamId)||!t.teamName)throw Error('Missing team identity');return{id:`openligadb:${t.teamId}`,provider:'openligadb',externalId:String(t.teamId),name:t.teamName};};
 const id=`openligadb:${shortcut}`,seasonId=`${id}:${year}`;
 const competition={id,provider:'openligadb',externalId:shortcut,name:shortcut==='bl1'?'Bundesliga':'2. Bundesliga',type:'league',country:{id:'openligadb:DE',provider:'openligadb',externalId:'DE',name:'Germany',code:'DE',continent:'Europe'},seasons:[{id:seasonId,competitionId:id,year,label:`${year}/${year+1}`,current:false,coverage:{fixtures:true,live:false,lineups:false,injuries:false}}]};
 const results=(raw.matchResults??[]).filter(r=>r.resultTypeKind==='After90Minutes');
 // Result-type numbers are league-configurable. Never mistake halftime or penalties for regulation.
 const score=results.length===1?results[0]:null,valid=score&&[score.pointsTeam1,score.pointsTeam2].every(n=>Number.isInteger(n)&&n>=0);
 const finished=raw.matchIsFinished===true&&valid;
 return{id:`openligadb:${raw.matchID}`,provider:'openligadb',externalId:String(raw.matchID),competition,seasonId,home:team(raw.team1),away:team(raw.team2),startsAt,kickoffPrecision:'instant',timeZone:'UTC',round:raw.group?.groupName??null,status:finished?'FT':raw.matchIsFinished?'UNKNOWN':'NS',label:finished?'Historical':'Scheduled',elapsed:null,venue:null,homeScore:finished?score.pointsTeam1:null,awayScore:finished?score.pointsTeam2:null,...(finished?{regulationScore:{home:score.pointsTeam1,away:score.pointsTeam2}}:{}),sourceUrl:`${BASE}/getmatchdata/${raw.matchID}`,sourceUpdatedAt:raw.lastUpdateDateTime??null,sourceAttribution:'Data from OpenLigaDB, licensed under ODbL 1.0',licenseUrl:OPENLIGA_LICENSE,coverageNote:'Community-maintained schedule/results, refreshed periodically; not a verified live feed. Images excluded.'};
}
export async function syncOpenLiga(service){
 const s=service.store,now=new Date(s.now()),year=now.getUTCFullYear()-(now.getUTCMonth()<6?1:0),files=[],errors=[],providers=[];
 for(const shortcut of ['bl1','bl2'])for(const season of [year-1,year]){
  const key=`openligadb:${shortcut}:${season}`,prior=await s.cache(key);
  if(prior&&!prior.stale){files.push({source:key,state:'cached'});providers.push({provider:'openligadb',request:{shortcut,season},attempted:false,state:'cached',confirmed:prior.data.count});continue;}
  try{
   await service.http.sleep(200+Math.floor(Math.random()*500));
   const changed=await service.http.json('openligadb',`${BASE}/getlastchangedate/${shortcut}/${season}/0`);
   if(typeof changed!=='string'||!changed)throw Error('Invalid last-change response');
   if(prior?.data.changed===changed){await s.putCache(key,prior.data,6*3600000);files.push({source:key,state:'unchanged'});providers.push({provider:'openligadb',request:{shortcut,season},attempted:true,state:'unchanged',raw:0,confirmed:prior.data.count});continue;}
   const raw=await service.http.json('openligadb',`${BASE}/getmatchdata/${shortcut}/${season}`);
   if(!Array.isArray(raw)||!raw.length)throw Error('Empty match response');
   // Validate the entire response before any data writes.
   const report=await ingestFixtureBatch(service,'openligadb',{shortcut,season},counts=>{counts.raw=raw.length;return raw.map(r=>normalizeOpenLiga(r,shortcut,season));});providers.push(report);if(report.state==='error')throw Error(report.errors.join('; '));const fixtures={length:report.normalized};
   await s.putCache(key,{changed,importedAt:s.now(),count:fixtures.length},6*3600000);
   files.push({source:key,state:'imported',fixtures:fixtures.length});
  }catch(e){errors.push(`${key}: ${e.message}`);if(!providers.some(p=>p.request.shortcut===shortcut&&p.request.season===season))providers.push({provider:'openligadb',request:{shortcut,season},attempted:true,state:'error',errors:[e.message]});}
 }
 return{files,errors,providers,health:await recordIngestionHealth(s,'openligadb',providers),license:OPENLIGA_LICENSE};
}
// Public, provider-separated normalized database copy fulfils ODbL access obligations.
export async function openLigaExport(store){return{license:OPENLIGA_LICENSE,attribution:'Data from OpenLigaDB (https://www.openligadb.de), normalized by Mnemba Tips',fixtures:(await store.all("SELECT payload FROM fixtures WHERE provider='openligadb' ORDER BY id")).map(r=>JSON.parse(r.payload))};}
