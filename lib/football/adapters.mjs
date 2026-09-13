import {digest} from './http.mjs';
import {namespace,FINAL,LIVE} from './providers.mjs';
const number=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const clean=s=>String(s??'').replace(/\s*\([A-Z]{3}\)\s*$/,'').trim();
export function sportsCompetition(raw){
 const id=namespace('thesportsdb',raw.idLeague),year=Number(String(raw.strCurrentSeason??raw.strSeason??'').slice(0,4));
 const country=raw.strCountry&&raw.strCountry!=='International'?{id:namespace('thesportsdb',raw.strCountry),provider:'thesportsdb',externalId:raw.strCountry,name:raw.strCountry,code:null,continent:null}:null;
 return{id,provider:'thesportsdb',externalId:String(raw.idLeague),name:raw.strLeague,type:raw.strLeagueType??null,country,badge:raw.strBadge??null,gender:raw.strGender??null,website:raw.strWebsite??null,seasons:year>=1850?[{id:`${id}:${year}`,competitionId:id,year,current:true,coverage:{fixtures:true,standings:'free-endpoint-dependent',live:false,lineups:false,injuries:false}}]:[]};
}
export function normalizeSportsEvent(raw,league={}){
 if(raw.strSport&&raw.strSport!=='Soccer')return null;
 if(!raw.idEvent||!raw.idHomeTeam||!raw.idAwayTeam||!raw.strHomeTeam||!raw.strAwayTeam||!raw.dateEvent)return null;
 const competition=sportsCompetition({...league,idLeague:raw.idLeague,strLeague:raw.strLeague,strSeason:raw.strSeason});
 if(!competition.seasons.length)return null;
 const timestamp=raw.strTimestamp?(raw.strTimestamp.endsWith('Z')||/[+-]\d\d:\d\d$/.test(raw.strTimestamp)?raw.strTimestamp:raw.strTimestamp+'Z'):raw.strTime?`${raw.dateEvent}T${raw.strTime.replace(/Z$/,'')}Z`:`${raw.dateEvent}T12:00:00Z`;
 const startsAt=Date.parse(timestamp);if(!Number.isFinite(startsAt))return null;
 const status=raw.strPostponed==='yes'?'PST':({'Match Finished':'FT','Not Started':'NS','Match Postponed':'PST','Cancelled':'CANC','Half Time':'HT','1st Half':'1H','2nd Half':'2H'})[raw.strStatus]??raw.strStatus??'UNKNOWN';
 const team=side=>({id:namespace('thesportsdb',raw[`id${side}Team`]),provider:'thesportsdb',externalId:String(raw[`id${side}Team`]),name:raw[`str${side}Team`],logo:raw[`str${side}TeamBadge`]||null});
 return{id:namespace('thesportsdb',raw.idEvent),provider:'thesportsdb',externalId:String(raw.idEvent),competition,seasonId:competition.seasons[0].id,home:team('Home'),away:team('Away'),startsAt,status,homeScore:number(raw.intHomeScore),awayScore:number(raw.intAwayScore),elapsed:null,venue:raw.strVenue||null,venueCountry:raw.strCountry||null,label:FINAL.has(status)?'Historical':LIVE.has(status)?'Estimated':'Scheduled',kickoffPrecision:raw.strTimestamp||raw.strTime?'instant':'date',timeZone:raw.strTimestamp||raw.strTime?'UTC':null,sourceUrl:`https://www.thesportsdb.com/event/${raw.idEvent}`,crossReferences:raw.idAPIfootball?{apiFootballId:raw.idAPIfootball}:null,coverageNote:'Community-maintained free metadata; not an official live feed.'};
}
export class SportsDbAdapter {
 constructor(http){this.http=http;}
 async catalog(){const data=await this.http.json('thesportsdb','https://www.thesportsdb.com/api/v1/json/123/all_leagues.php');return(data.leagues??[]).filter(l=>l.strSport==='Soccer').map(sportsCompetition);}
 async fixtures(day){const data=await this.http.json('thesportsdb',`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${day}&s=Soccer`);return(data.events??[]).map(e=>normalizeSportsEvent(e)).filter(Boolean);}
 async teams(leagueId){const data=await this.http.json('thesportsdb',`https://www.thesportsdb.com/api/v1/json/123/search_all_teams.php?id=${encodeURIComponent(leagueId)}`);return(data.teams??[]).filter(t=>t.strSport==='Soccer').map(t=>({id:namespace('thesportsdb',t.idTeam),provider:'thesportsdb',externalId:String(t.idTeam),name:t.strTeam,aliases:(t.strAlternate??'').split(';').filter(Boolean),logo:t.strBadge??t.strTeamBadge??null,country:t.strCountry,stadium:t.strStadium,website:t.strWebsite,links:{x:t.strTwitter,facebook:t.strFacebook,instagram:t.strInstagram,youtube:t.strYoutube},sourceUrl:`https://www.thesportsdb.com/team/${t.idTeam}`}));}
 async players(teamId){const d=await this.http.json('thesportsdb',`https://www.thesportsdb.com/api/v1/json/123/lookup_all_players.php?id=${encodeURIComponent(teamId)}`);return(d.player??[]).filter(p=>String(p.idTeam)===String(teamId)&&p.idPlayer&&p.strPlayer&&!/manager|coach/i.test(p.strPosition??'')).map(p=>({id:namespace('thesportsdb',p.idPlayer),provider:'thesportsdb',externalId:String(p.idPlayer),teamId:namespace('thesportsdb',teamId),name:p.strPlayer,position:p.strPosition,minutes:null,rating:null,availability:'unknown',country:p.strNationality,sourceUrl:`https://www.thesportsdb.com/player/${p.idPlayer}`}));}
 async standings(leagueId,season){const d=await this.http.json('thesportsdb',`https://www.thesportsdb.com/api/v1/json/123/lookuptable.php?l=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`);return d.table??[];}
}
const MONTHS={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
export function parseFootballText(text,entry){
 const header=text.match(/^=+\s*(.+)$/m)?.[1]?.trim();if(!header)return{fixtures:[],warnings:['Missing competition header']};
 let year=entry.year??Number(entry.season?.slice(0,4)),month=0,day=null,clock=null,round='';const games=[],warnings=[];
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith('='))continue;
  if(/^[▪»]/.test(line)){round=line.slice(1).trim();continue;}
  const date=line.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if(date){const nextMonth=MONTHS[date[1]];if(date[3])year=Number(date[3]);else if(month&&nextMonth<month-5)year++;month=nextMonth;day=`${year}-${String(month).padStart(2,'0')}-${date[2].padStart(2,'0')}`;clock=null;continue;}
  const iso=line.match(/^(\d{4}-\d{2}-\d{2})$/);if(iso){day=iso[1];clock=null;continue;}
  const resultLine=line.replace(/^\d{1,2}:\d{2}\s+/, '');const result=resultLine.match(/^(.+?)\s+(\d+)\s*[-:]\s*(\d+)\s+(?:\(\d+[-:]\d+\)\s+)?(.+?)(?:\s+@\s+.*|\s+\[.*)?$/);
  if(result&&day&&!line.startsWith('(')&&! /\s(?:v|vs\.?)\s/.test(line)){clock=line.match(/^(\d{1,2}:\d{2})\s+/)?.[1]??clock;games.push({date:day,time:clock,team1:clean(result[1]),team2:clean(result[4]),score:{ft:[Number(result[2]),Number(result[3])]},round});continue;}
  const match=line.match(/^(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+(?:v|vs\.?|–)\s+(.+?)(?:\s{2,}(\d+)\s*[-:]\s*(\d+)(?:\s|$).*)?(?:\s+@\s+.*)?$/);
  if(!match||!day)continue;
  if(match[1])clock=match[1];let away=match[3],homeScore=number(match[4]),awayScore=number(match[5]);
  const tail=away.match(/^(.*?)\s+(\d+)\s*[-:]\s*(\d+)(?:\s|$)/);if(tail){away=tail[1];homeScore=Number(tail[2]);awayScore=Number(tail[3]);}
  if(/\b(?:TBD|Winner|Loser)\b/i.test(match[2]+' '+away)){warnings.push('Unresolved participant skipped');continue;}
  games.push({date:day,time:clock,team1:clean(match[2]),team2:clean(away),score:homeScore===null?null:{ft:[homeScore,awayScore]},round});
 }
 return{fixtures:games,name:header,warnings};
}
export async function normalizeOpenFile(body,entry){
 const parsed=typeof body==='string'?parseFootballText(body,entry):{fixtures:body.matches??body.rounds?.flatMap(r=>(r.matches??[]).map(m=>({...m,round:r.name??m.round})))??[],name:body.name,warnings:[]};
 const compCode=entry.competitionId??`${entry.repository}:${entry.path.replace(/(?:19|20)\d\d(?:[-/]\d{2,4})?\/?/g,'').replace(/\.(json|txt)$/,'')}`;
 const externalId=await digest(compCode),id=namespace('openfootball',externalId),year=entry.year??Number(entry.season?.slice(0,4));
 if(!Number.isFinite(year))return{fixtures:[],warnings:['No verified season year']};
 const season={id:`${id}:${year}`,competitionId:id,year,current:year>=new Date().getUTCFullYear()-1,coverage:{fixtures:true,live:false,lineups:false,injuries:false}};
 const code=entry.path.split('/').at(-1).match(/^(?:\d{4}(?:-\d{2})?_)?(en|de|es|it|fr|be|sa|br|ar)(?:[.1-9_-])/)?.[1]??({england:'en',deutschland:'de',espana:'es',italy:'it',belgium:'be'})[entry.repository];
 const geography={en:['England','Europe','UEFA'],de:['Germany','Europe','UEFA'],es:['Spain','Europe','UEFA'],it:['Italy','Europe','UEFA'],fr:['France','Europe','UEFA'],be:['Belgium','Europe','UEFA'],sa:['Saudi Arabia','Asia','AFC'],br:['Brazil','South America','CONMEBOL'],ar:['Argentina','South America','CONMEBOL']}[code];
 const country=geography?{id:`openfootball:country:${code}`,provider:'openfootball',externalId:code,name:geography[0],code:null,continent:geography[1],confederation:geography[2],sourceUrl:entry.url}:null;
 const competition={id,provider:'openfootball',externalId,name:(parsed.name??entry.path).replace(/\s+20\d{2}[/-]\d{2,4}\s*$/,'').trim(),country,confederation:geography?.[2]??(/champions-league/.test(entry.repository)?'UEFA':entry.repository==='south-america'?'CONMEBOL':null),type:null,seasons:[season]};
 const fixtures=[];
 for(const g of parsed.fixtures){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(g.date??''))continue;
  const name=t=>clean(typeof t==='string'?t:t?.name),homeName=name(g.team1),awayName=name(g.team2);if(!homeName||!awayName)continue;
  if([homeName,awayName].some(n=>/^(?:[A-L][1-4]|[123][A-L](?:\/[A-L])*|[WL]\d+|TBD|TBC|\?+)$|\b(?:Winner|Loser)\b/i.test(n))){parsed.warnings.push('Unresolved participant skipped');continue;}
  const scores=Array.isArray(g.score)?g.score:g.score?.ft;
  const completed=Array.isArray(scores)&&scores.length===2&&scores.every(v=>Number.isFinite(v));
  const team=n=>({id:namespace('openfootball',encodeURIComponent(n)),provider:'openfootball',externalId:n,name:n});
  const fixtureId=await digest([compCode,g.date,homeName,awayName,g.round??'']);
  fixtures.push({id:namespace('openfootball',fixtureId),provider:'openfootball',externalId:fixtureId,competition,seasonId:season.id,home:team(homeName),away:team(awayName),startsAt:Date.parse(g.date+'T12:00:00Z'),date:g.date,localKickoff:g.time??null,round:g.round??null,timeZone:null,kickoffPrecision:'date',status:completed?'FT':'NS',homeScore:completed?scores[0]:null,awayScore:completed?scores[1]:null,elapsed:null,venue:null,label:completed?'Historical':'Scheduled',sourceUrl:entry.url,coverageNote:'Calendar date is verified; local kickoff has no verified time zone. No live clock or timed snapshot is inferred.'});
 }
 return{fixtures,warnings:parsed.warnings};
}
export class OpenFootballAdapter {
 constructor(http,store){this.http=http;this.store=store;}
 async repositories(){const list=[];for(let page=1;;page++){const rows=await this.http.json('openfootball',`https://api.github.com/orgs/openfootball/repos?per_page=100&page=${page}`);list.push(...rows);if(rows.length<100)break;}return list.filter(r=>r.license?.spdx_id==='CC0-1.0'&&!/^(clubs|players|help|docs|spec|schema|sandbox|quick-starter|league-starter|v0-format)/.test(r.name));}
 async discover(repository,branch='master'){
  if(!/^[a-z0-9_.-]+$/.test(repository))throw new Error('Invalid repository');
  const tree=await this.http.json('openfootball',`https://api.github.com/repos/openfootball/${repository}/git/trees/${branch}?recursive=1`);
  if(tree.truncated)throw new Error('Repository tree is truncated; explicit subtree discovery is required');
  const entries=[];
  for(const f of tree.tree??[]){
   const season=f.path.match(/(?:^|\/)((?:19|20)\d{2}(?:-\d{2,4})?)(?:\/|[._-])/);if(f.type!=='blob'||!season||! /\.(json|txt)$/.test(f.path)||/(README|LICENSE|NOTES|teams|squads|players|stadiums|goals)/i.test(f.path))continue;
   const id=await digest([repository,f.path]),url=`https://raw.githubusercontent.com/openfootball/${repository}/${branch}/${f.path}`;
   const entry={id,repository,path:f.path,url,season:season[1],year:Number(season[1].slice(0,4)),format:f.path.endsWith('.json')?'json':'txt',licenseRef:`https://github.com/openfootball/${repository}/blob/${branch}/LICENSE.md`};entries.push(entry);
   await this.store.run('INSERT INTO source_files(id,source_id,repository,path,url,season,year,format,license_ref) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(repository,path) DO UPDATE SET url=excluded.url,license_ref=excluded.license_ref',id,'openfootball',repository,f.path,url,entry.season,entry.year,entry.format,entry.licenseRef);
  }
  return entries;
 }
 async load(entry){const response=await this.http.request('openfootball',entry.url);if(!response.ok)throw new Error(`OpenFootball HTTP ${response.status}`);return normalizeOpenFile(entry.format==='json'?await response.json():await response.text(),entry);}
}
export class WikidataAdapter {
 constructor(http){this.http=http;}
 async search(name){const url=new URL('https://www.wikidata.org/w/api.php');url.search=new URLSearchParams({action:'wbsearchentities',search:name,language:'en',format:'json',limit:'5',type:'item'}).toString();const d=await this.http.json('wikidata',url);return d.search??[];}
 async entities(ids){const safe=ids.filter(id=>/^Q\d+$/.test(id)).slice(0,50);if(!safe.length)return[];const url=new URL('https://www.wikidata.org/w/api.php');url.search=new URLSearchParams({action:'wbgetentities',ids:safe.join('|'),languages:'en|de',props:'labels|aliases|claims|descriptions',format:'json'}).toString();const data=await this.http.json('wikidata',url);return Object.values(data.entities??{}).filter(e=>!e.missing).map(e=>{
  const values=p=>(e.claims?.[p]??[]).filter(c=>c.rank!=='deprecated').map(c=>({value:c.mainsnak?.datavalue?.value,references:c.references??[]}));
  return{id:e.id,name:e.labels?.en?.value??e.id,description:e.descriptions?.en?.value??'',aliases:[...(e.aliases?.en??[]),...(e.aliases?.de??[])].map(a=>a.value).concat(values('P1448').map(v=>v.value?.text).filter(Boolean)),country:values('P17')[0]?.value?.id??values('P27')[0]?.value?.id??null,stadium:values('P115')[0]?.value?.id??null,website:values('P856')[0]?.value??null,instanceOf:values('P31').map(v=>v.value?.id),countryCode:values('P297')[0]?.value??null,continent:values('P30').map(v=>v.value?.id),social:{youtube:values('P2397'),x:values('P2002'),instagram:values('P2003'),facebook:values('P2013')},sourceUrl:`https://www.wikidata.org/wiki/${e.id}`};});}
 async squad(qid){if(!/^Q\d+$/.test(qid))throw new Error('Verified Wikidata club ID required');const query=`SELECT DISTINCT ?player ?playerLabel ?positionLabel ?start WHERE { ?player wdt:P31 wd:Q5; p:P54 ?membership; wdt:P106/wdt:P279* wd:Q937857. ?membership ps:P54 wd:${qid}. OPTIONAL { ?membership pq:P580 ?start. } OPTIONAL { ?membership pq:P582 ?end. } FILTER(!BOUND(?start)||?start<=NOW()) FILTER(!BOUND(?end)||?end>=NOW()) OPTIONAL { ?player wdt:P413 ?position. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 60`;const url=new URL('https://query.wikidata.org/sparql');url.search=new URLSearchParams({query,format:'json'}).toString();const response=await this.http.json('wikidata',url,{headers:{Accept:'application/sparql-results+json'}});const players=new Map();for(const r of response.results?.bindings??[]){const id=r.player?.value?.split('/').at(-1);if(!/^Q\d+$/.test(id??'')||!r.playerLabel?.value)continue;if(!players.has(id))players.set(id,{id,name:r.playerLabel.value,positions:[],membershipStart:r.start?.value??null,sourceUrl:`https://www.wikidata.org/wiki/${id}`});if(r.positionLabel?.value&&!players.get(id).positions.includes(r.positionLabel.value))players.get(id).positions.push(r.positionLabel.value);}return [...players.values()];}
 async countries(){const query='SELECT ?item ?itemLabel ?code ?continentLabel WHERE { ?item wdt:P297 ?code. OPTIONAL { ?item wdt:P30 ?continent. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 400';const url=new URL('https://query.wikidata.org/sparql');url.search=new URLSearchParams({query,format:'json'}).toString();const d=await this.http.json('wikidata',url,{headers:{Accept:'application/sparql-results+json'}});return(d.results?.bindings??[]).map(r=>({id:r.item.value.split('/').at(-1),name:r.itemLabel.value,code:r.code.value,continent:r.continentLabel?.value??null}));}
}
