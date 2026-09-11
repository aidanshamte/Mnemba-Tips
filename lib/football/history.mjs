import { namespace } from './providers.mjs';

export function normalizeStatsBomb(rows, entry) {
  const provider='statsbomb', id=namespace(provider,entry.competitionId);
  const season={id:`${id}:${entry.seasonId}`,competitionId:id,year:Number(entry.season.match(/\d{4}/)?.[0]),current:false,coverage:{historical:true,lineups:'match-dependent',events:'match-dependent'}};
  const competition={id,provider,externalId:String(entry.competitionId),name:entry.name,type:null,country:entry.country?{id:namespace(provider,entry.country),provider,externalId:entry.country,name:entry.country,code:null,continent:null}:null,seasons:[season]};
  return rows.filter(r=>r.match_status==='available'&&r.home_score!=null&&r.away_score!=null).map(r=>{
    const team=(t,side)=>({id:namespace(provider,t[`${side}_team_id`]),provider,externalId:String(t[`${side}_team_id`]),name:t[`${side}_team_name`]});
    const startsAt=Date.parse(`${r.match_date}T${r.kick_off??'00:00:00.000'}Z`);
    if(!Number.isFinite(startsAt)||!Number.isFinite(season.year))throw new Error('Invalid historical date');
    return {id:namespace(provider,r.match_id),provider,externalId:String(r.match_id),competition,seasonId:season.id,home:team(r.home_team,'home'),away:team(r.away_team,'away'),startsAt,localKickoff:r.kick_off??null,timeZone:null,kickoffPrecision:'date',sourceUrl:`https://raw.githubusercontent.com/statsbomb/open-data/master/data/matches/${entry.competitionId}/${entry.seasonId}.json`,status:'FT',elapsed:null,venue:r.stadium?.name??null,homeScore:r.home_score,awayScore:r.away_score,label:'Historical',attribution:'StatsBomb Open Data — https://github.com/statsbomb/open-data'};
  });
}
export function normalizeOpenHistory(body, entry) {
  const provider='openfootball',id=namespace(provider,entry.competitionId);
  const season={id:`${id}:${entry.seasonId}`,competitionId:id,year:Number(entry.season.slice(0,4)),current:false,coverage:{historical:true}};
  const competition={id,provider,externalId:entry.competitionId,name:body.name??entry.name,type:null,country:null,seasons:[season]};
  const rows=body.matches??body.rounds?.flatMap(r=>r.matches??[])??[];
  return rows.filter(r=>r.score?.ft?.length===2&&r.score.ft.every(Number.isFinite)).map(r=>{
    const team=t=>{const name=typeof t==='string'?t:t?.name;if(!name)throw new Error('Missing historical team');return{id:namespace(provider,encodeURIComponent(name)),provider,externalId:name,name};};
    const home=team(r.team1),away=team(r.team2),externalId=String(r.id??`${entry.competitionId}:${r.date}:${home.externalId}:${away.externalId}`);
    const startsAt=Date.parse(`${r.date}T${r.time??'00:00'}:00Z`);
    if(!Number.isFinite(startsAt))throw new Error('Invalid historical date');
    return{id:namespace(provider,externalId),provider,externalId,competition,seasonId:season.id,home,away,startsAt,localKickoff:r.kick_off??null,timeZone:null,kickoffPrecision:'date',sourceUrl:`https://raw.githubusercontent.com/statsbomb/open-data/master/data/matches/${entry.competitionId}/${entry.seasonId}.json`,status:'FT',elapsed:null,venue:null,homeScore:r.score.ft[0],awayScore:r.score.ft[1],label:'Historical',attribution:'OpenFootball — public domain',timePrecision:r.time?'Provider local time; timezone unspecified':'Date only; midnight placeholder for ordering'};
  });
}
