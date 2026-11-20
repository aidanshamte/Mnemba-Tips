import policy from '../../config/live-sources.json' with {type:'json'};
import {LIVE,FINAL,labelFor} from './providers.mjs';
import {liveScoreLogoCandidate,liveScoreCompetitionLogoCandidate} from './logo-discovery.mjs';
const PUBLIC='https://prod-cdn-public-api.lsmedia1.com';
const required=(v,name)=>{if(v===null||v===undefined||v==='')throw Error(`LiveScore missing ${name}`);return v;};
const id=v=>`livescore:${required(v,'identity')}`;
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function liveScorePermission(env={},p=policy.livescore){
 return env.MNEMBA_LIVESCORE_ENABLED==='1'&&p.automationAllowed===true&&p.storageAllowed===true&&p.publicDisplayAllowed===true&&Boolean(p.permissionEvidence)&&p.contractVerified===true&&p.dailyLimit>0&&Boolean(p.discoveryUrl);
}
// LiveScore v2 discovery and public match responses captured on 2026-09-24.
export function normalizeLiveScore(event,stage,options={}){
 const rawDate=event.Est!=null?new Date(Number(event.Est)*1000).toISOString():required(event.Esd,'kickoff');let date=String(rawDate);
 if(/^\d{14}$/.test(date)){
  if(options.compactTimestampTimezone!=='UTC')throw Error('LiveScore compact kickoff timezone is unverified');
  date=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${date.slice(8,10)}:${date.slice(10,12)}:${date.slice(12,14)}Z`;
 }
 if(!/(Z|[+-]\d{2}:\d{2})$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('LiveScore kickoff requires an explicit timezone');
 const status=(/^\d+(?:\+\d+)?['′]$/.test(event.Eps)?({2:'1H',3:'2H'}[event.Esid]):null)??({'Not started':'NS','1st half':'1H','Half time':'HT','2nd half':'2H','Finished':'FT','After extra time':'AET','After penalties':'PEN','Postponed':'PST','Cancelled':'CANC'})[event.Eps]??event.Eps;
 if(![...LIVE,...FINAL,'NS','PST','CANC','ABD','SUSP'].includes(status))throw Error('Unrecognized LiveScore status');
 const team=t=>({id:id(t?.ID),provider:'livescore',externalId:String(t.ID),name:required(t.Nm,'team name'),...(liveScoreLogoCandidate(t,event.Eid)?{logoCandidate:liveScoreLogoCandidate(t,event.Eid)}:{})});
 const competitionId=id(stage.Sid),season=String(stage.Season??stage.CompST??`stage-${required(stage.Sid,'stage')}`);
 const competition={id:competitionId,provider:'livescore',externalId:String(stage.Sid),name:required(stage.Snm,'competition name'),type:null,...(liveScoreCompetitionLogoCandidate(stage,event.Eid)?{logoCandidate:liveScoreCompetitionLogoCandidate(stage,event.Eid)}:{}),country:stage.Cnm?{id:id(stage.Cid??stage.Cnm),provider:'livescore',externalId:String(stage.Cid??stage.Cnm),name:stage.Cnm,code:null,continent:null}:null,seasons:[{id:`${competitionId}:${season}`,competitionId,year:/^\d{4}/.test(season)?Number(season.slice(0,4)):new Date(date).getUTCFullYear(),current:true,coverage:{},providerSeason:stage.Season??stage.CompST??null,seasonResolution:stage.Season||stage.CompST?'provider-season':'provider-stage-with-kickoff-calendar-year'}]};
 return {id:id(event.Eid),provider:'livescore',externalId:String(event.Eid),competition,seasonId:competition.seasons[0].id,home:team(event.T1?.[0]),away:team(event.T2?.[0]),startsAt:Date.parse(date),status,label:labelFor(status),elapsed:typeof event.Etm==='object'?(/^\d+/.test(event.Eps)?Number.parseInt(event.Eps,10):number(event.Etm?.RTm)==null?null:Math.floor(event.Etm.RTm/60000)):number(event.Etm),homeScore:number(event.Tr1),awayScore:number(event.Tr2),regulationScore:null,sourceUrl:`${PUBLIC}/v1/api/app/scoreboard/soccer/${encodeURIComponent(event.Eid)}`};
}
export function liveScoreStages(body){
 if(Array.isArray(body?.Sctns))return body.Sctns.filter(s=>s.Ts&&Array.isArray(s.Ts.Evs)).map(s=>({...s.Ts,Events:s.Ts.Evs}));
 if(Array.isArray(body?.Stages))return body.Stages;
 throw Error('Unverified LiveScore discovery envelope');
}
export function parseLiveScoreDiscovery(body,options={}){
 body={Stages:liveScoreStages(body)};
 if(!Array.isArray(body?.Stages))throw Error('Unverified LiveScore discovery envelope');
 return body.Stages.flatMap(stage=>{if(!Array.isArray(stage.Events))throw Error('Missing LiveScore events');return stage.Events.map(event=>normalizeLiveScore(event,stage,options));});
}
export function parseLiveScoreIncidents(body,fixture){
 if(body?.Incs&&typeof body.Incs==='object'){
 const rows=Object.entries(body.Incs).flatMap(([period,events])=>{if(!Array.isArray(events))throw Error('Invalid LiveScore incident period');return events.map(e=>({id:`livescore:${required(body.Eid,'event')}:${period}:${required(e.Min,'minute')}:${e.IT}:${e.Nm}:${e.ID??e.Aid??''}:${e.Sor??0}`,minute:number(e.Min),team:e.Nm===1?fixture?.home:e.Nm===2?fixture?.away:null,player:e.Pn??([e.Fn,e.Ln].filter(Boolean).join(' ')||null),type:Array.isArray(e.Sc)?'Goal':`Provider event ${e.IT}`,detail:null,providerType:e.IT,score:e.Sc??null}));});
 return [...new Map(rows.map(r=>[r.id,r])).values()];
 }
 if(!Array.isArray(body?.Incidents))throw Error('Unverified LiveScore incidents envelope');
 // Explicit documented field names only; never infer event types from numeric codes.
 return [...new Map(body.Incidents.map(e=>{required(e.ID,'incident ID');required(e.Type,'incident type');const row={id:id(e.ID),minute:number(e.Minute),team:typeof e.Team==='string'?e.Team:null,player:typeof e.Player==='string'?e.Player:null,type:String(e.Type),detail:typeof e.Detail==='string'?e.Detail:null};return [row.id,row];})).values()];
}
export function parseLiveScoreLineups(body,fixture){
 if(Array.isArray(body?.Lu))return body.Lu.map(t=>{const team=t.Tnb===1?fixture?.home:t.Tnb===2?fixture?.away:null;if(!team||!Array.isArray(t.Ps))throw Error('LiveScore lineup identity mismatch');return {team:{id:team.id,name:team.name},formation:Array.isArray(t.Fo)?t.Fo.join('-'):null,players:t.Ps.filter(p=>p.Pos!==10).map(p=>({id:id(required(p.Pid,'player')),name:required(p.Snm??[p.Fn,p.Ln].filter(Boolean).join(' '),'player name'),jersey:number(p.Snu),position:p.Pon??null,started:typeof p.Fp==='string'}))};});
 if(!Array.isArray(body?.Lineups))throw Error('Unverified LiveScore lineups envelope');
 return body.Lineups.map(t=>{if(!Array.isArray(t.Players))throw Error('Missing LiveScore players');return{team:{id:id(t.TeamID),name:required(t.TeamName,'lineup team')},formation:typeof t.Formation==='string'?t.Formation:null,players:t.Players.map(p=>({id:id(p.ID),name:required(p.Name,'player name'),jersey:number(p.Number),position:typeof p.Position==='string'?p.Position:null,started:typeof p.Started==='boolean'?p.Started:null}))};});
}
export class LiveScoreAdapter{
 constructor(http,env={},config=policy.livescore){this.http=http;this.env=env;this.config=config;}
 async request(resource,eventId){
  if(!liveScorePermission(this.env,this.config))throw Error('LiveScore disabled: authorization and verified response contract required');
  let url;
  if(resource==='discovery'){url=new URL(this.config.discoveryUrl);if(url.origin!=='https://prod-cdn-mev-api.lsmedia1.com')throw Error('LiveScore discovery host not approved');}
  else{if(!['scoreboard','incidents','lineups'].includes(resource)||!/^\d+$/.test(String(eventId)))throw Error('Unapproved LiveScore resource');url=new URL(`${PUBLIC}/v1/api/app/${resource}/soccer/${eventId}`);}
  return this.http.json('livescore',url.href);
 }
 async discovery(counts){const body=await this.request('discovery'),stages=liveScoreStages(body),fixtures=[];if(counts){counts.raw=stages.reduce((n,s)=>n+s.Events.length,0);counts.rejected=0;}for(const stage of stages)for(const event of stage.Events){try{fixtures.push(normalizeLiveScore(event,stage,this.config));}catch(error){if(!counts)throw error;counts.rejected++;(counts.errors??=[]).push(`${event.Eid??'unknown'}: ${error.message}`);}}return fixtures;}
 async checkedDetail(resource,eventId){const body=await this.request(resource,eventId);if(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0){const error=new Error('LiveScore detail not published');error.name='LiveScoreDetailUnavailable';throw error;}if(String(body?.Eid)!==String(eventId))throw Error('LiveScore detail identity mismatch');if(resource==='incidents'&&!body.Incs&&!body.Incidents||resource==='lineups'&&!body.Lu&&!body.Lineups){const error=new Error('LiveScore detail not published');error.name='LiveScoreDetailUnavailable';throw error;}return body;}
 async match(service,fixture,kind){
  if(kind==='selected'){
   const body=await this.request('scoreboard',fixture.externalId);
   const event=body.Event??body,stage=body.Stage??body.Stg;if(!stage)throw Error('Unverified LiveScore scoreboard envelope');
   const next=normalizeLiveScore(event,stage,this.config);if(next.id!==fixture.id||next.home.id!==fixture.home.id||next.away.id!==fixture.away.id)throw Error('LiveScore scoreboard identity mismatch');
   await service.saveFixtures([next]);
  }else if(kind==='events')await service.detailRecord('fixture_events',fixture,parseLiveScoreIncidents(await this.checkedDetail('incidents',fixture.externalId),fixture));
  else if(kind==='lineups'){
   const rows=parseLiveScoreLineups(await this.checkedDetail('lineups',fixture.externalId),fixture);if(rows.some(r=>![fixture.home.id,fixture.away.id].includes(r.team.id)))throw Error('LiveScore lineup identity mismatch');await service.detailRecord('lineups',fixture,rows);
  }else throw Error('Perform/Opta statistics disabled pending separate authorization and schema');
 }
}
