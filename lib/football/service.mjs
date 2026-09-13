import {dayBounds} from './timezone.mjs';
import {cleanText} from './news.mjs';
import {groupCompetitions} from './competition-catalog.mjs';
import {statsBombLineups,positionMinutes} from './statsbomb-lineups.mjs';
import { Provider, normalizeCompetition, normalizeFixture, namespace, LIVE, FINAL, SCHEDULED, featuredCategory } from './providers.mjs';
import { form, headToHead, predictedLineup, project, evaluate, elo } from './model.mjs';
import { syncNews, deduplicate } from './news.mjs';
import { normalizeStatsBomb, normalizeOpenHistory } from './history.mjs';

export const INTERVALS = Object.freeze({ live:1800000, selected:300000, today:21600000, upcoming:43200000, calendar:43200000, standings:43200000, teams:86400000, players:86400000, 'player-statistics':86400000, injuries:21600000, lineups:21600000, news:10800000, historical:604800000, 'history-import':604800000, catalog:604800000, countries:604800000, scorers:86400000, statistics:86400000 });
export function dueJobs({ now, visible, fixtures = [], selected, competition, season }) {
  if (!visible) return [];
  const jobs = ['catalog:api-football','catalog:football-data','countries:api-football','countries:football-data','today','upcoming'];
  if (fixtures.some(f => LIVE.has(f.status))) jobs.unshift('live');
  if (selected) {
    const match = fixtures.find(f => f.id === selected);
    if (match && LIVE.has(match.status)) jobs.unshift(`selected:${selected}`);
    if (match && (LIVE.has(match.status) || Math.abs(match.startsAt-now) < 3600000)) jobs.push(`lineups:${selected}`,`injuries:${selected}`);
    if (match && (LIVE.has(match.status)||FINAL.has(match.status))) jobs.push(`player-statistics:${selected}`);
  }
  if (competition && season && /^(api-football|football-data):/.test(competition)) jobs.push(`calendar:${season}`,`teams:${season}`,`standings:${season}`,`scorers:${season}`,`players:${season}`,`statistics:${season}`);
  jobs.push('news','historical');
  return jobs;
}
export class FootballService {
  constructor(store, env = {}, options = {}) {
    this.store = store; this.env = env; this.options = options;
    this.providers = { 'api-football': new Provider('api-football', env.API_FOOTBALL_KEY, store, options), 'football-data': new Provider('football-data', env.FOOTBALL_DATA_KEY, store, options) };
    const fetcher=options.fetcher??fetch;
    this.fetcher = (...args)=>fetcher(...args);
  }
  async saveCompetition(c, authoritative = true) {
    const s = this.store, now = s.now();
    const existing = !authoritative && await s.one('SELECT id FROM competitions WHERE id=?',c.id);
    if(c.country&&!existing) await s.upsert('countries', { id:c.country.id, provider:c.provider, external_id:c.country.externalId, name:c.country.name, code:c.country.code, continent:c.country.continent, payload:JSON.stringify(c.country), updated_at:now });
    if(!existing) await s.upsert('competitions', { id:c.id,provider:c.provider,external_id:c.externalId,country_id:c.country?.id??null,name:c.name,type:c.type,payload:JSON.stringify({...c,featured:featuredCategory(c)}),updated_at:now });
    for(const season of c.seasons) {
      if (!authoritative && await s.one('SELECT id FROM seasons WHERE id=?',season.id)) continue;
      await s.upsert('seasons', { id:season.id,competition_id:c.id,year:season.year,current:Number(season.current),coverage:JSON.stringify(season.coverage),payload:JSON.stringify(season),updated_at:now });
    }
  }
  async saveTeam(team, seasonId = null) {
    const old = await this.store.one('SELECT payload FROM football_teams WHERE id=?',team.id);
    const data = {...(old?JSON.parse(old.payload):{}),...team};
    await this.store.upsert('football_teams', { id:team.id,provider:team.provider,external_id:team.externalId,name:team.name,country_id:null,payload:JSON.stringify(data),updated_at:this.store.now() });
    if(seasonId) await this.store.run('INSERT OR IGNORE INTO season_teams(season_id,team_id) VALUES(?,?)',seasonId,team.id);
  }
  async saveFixtures(fixtures) {
    for(const f of fixtures) {
      await this.saveCompetition(f.competition,false); await this.saveTeam(f.home,f.seasonId); await this.saveTeam(f.away,f.seasonId);
      await this.store.upsert('fixtures', { id:f.id,provider:f.provider,external_id:f.externalId,competition_id:f.competition.id,season_id:f.seasonId,home_team_id:f.home.id,away_team_id:f.away.id,starts_at:f.startsAt,status:f.status,home_score:f.homeScore,away_score:f.awayScore,label:f.label,payload:JSON.stringify(f),updated_at:this.store.now() });
      if(FINAL.has(f.status)) await this.evaluateFixture(f);
    }
    // Recompute affected upcoming predictions when fixtures or results change.
    const teamIds = [...new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))];
    for(const teamId of teamIds) {
      const history = await this.history(teamId);
      await this.store.upsert('team_form',{id:teamId,label:history.length?'Historical':'Unavailable',payload:JSON.stringify({ overall:form(history,teamId),home:form(history,teamId,Infinity,'home'),away:form(history,teamId,Infinity,'away') }),updated_at:this.store.now()});
    }
    const next = await this.store.all('SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? ORDER BY starts_at LIMIT 100',this.store.now(),this.store.now()+7*86400000);
    for(const row of next) { const f=JSON.parse(row.payload); if(SCHEDULED.has(f.status)&&teamIds.some(t=>t===f.home.id||t===f.away.id)) await this.predict(f); }
  }
  async history(home, away = home) { return (await this.store.all('SELECT payload FROM fixtures WHERE (home_team_id IN (?,?) OR away_team_id IN (?,?)) AND starts_at<? ORDER BY starts_at DESC LIMIT 300',home,away,home,away,this.store.now())).map(r=>JSON.parse(r.payload)); }
  async predict(f) {
    if(f.startsAt<=this.store.now() || !SCHEDULED.has(f.status)) return null;
    const history=await this.history(f.home.id,f.away.id);
    const h2h=headToHead(history,f.home.id,f.away.id,f.startsAt);
    await this.store.upsert('head_to_head',{id:`${f.home.id}|${f.away.id}`,home_team_id:f.home.id,away_team_id:f.away.id,label:h2h.label,payload:JSON.stringify(h2h),updated_at:this.store.now()});
    const playerRows=await this.store.all('SELECT payload FROM football_players WHERE team_id IN (?,?)',f.home.id,f.away.id);
    const players=playerRows.map(r=>JSON.parse(r.payload));
    for(const player of players) {
      const recent=await this.store.all('SELECT a.minutes,a.rating FROM football_appearances a JOIN fixtures fx ON fx.id=a.fixture_id WHERE a.player_id=? AND fx.starts_at<? ORDER BY fx.starts_at DESC LIMIT 10',player.id,f.startsAt);
      const rated=recent.filter(r=>r.minutes>0&&r.rating!==null);
      if(rated.length) {player.minutes=rated.reduce((n,r)=>n+r.minutes,0);player.rating=rated.reduce((n,r)=>n+r.rating*r.minutes,0)/player.minutes;}
    }
    const injuryRow=await this.store.one('SELECT payload FROM injuries WHERE fixture_id=?',f.id);
    const injuryList=injuryRow?JSON.parse(injuryRow.payload):[];
    for(const player of players) {
      const injury=injuryList.find(i=>namespace(f.provider,i.player?.id)===player.id);
      if(injury)player.availability=/suspend|red card|yellow card/i.test(injury.player?.reason??'')?'suspended':/doubt/i.test(injury.player?.type??'')?'doubtful':'injured';
    }
    const availability = injuryRow ? (injuryList.filter(i=>namespace(f.provider,i.team?.id)===f.away.id).length-injuryList.filter(i=>namespace(f.provider,i.team?.id)===f.home.id).length)/11 : null;
    const means = [f.home.id,f.away.id].map(id=>{ const list=players.filter(p=>p.teamId===id&&p.rating!=null&&p.minutes>0); return list.length?list.reduce((n,p)=>n+p.rating*p.minutes,0)/list.reduce((n,p)=>n+p.minutes,0):null; });
    const projected=[f.home.id,f.away.id].map(id=>predictedLineup(players.filter(p=>p.teamId===id)));
    let lineupStrength=projected.every(p=>p.players.length===11)?(projected[0].players.reduce((n,p)=>n+p.rating,0)-projected[1].players.reduce((n,p)=>n+p.rating,0))/110:null;
    const confirmedRow=await this.store.one("SELECT payload FROM lineups WHERE fixture_id=? AND label='Confirmed'",f.id);
    if(confirmedRow) {
      const confirmed=JSON.parse(confirmedRow.payload);
      const strengths=[f.home.id,f.away.id].map(teamId=>{const xi=confirmed.find(t=>namespace(f.provider,t.team?.id)===teamId)?.startXI??[];const rated=xi.map(p=>players.find(r=>r.id===namespace(f.provider,p.player?.id))).filter(p=>p?.rating!=null);return rated.length===11?rated.reduce((sum,p)=>sum+p.rating,0)/11:null;});
      if(strengths.every(v=>v!==null))lineupStrength=(strengths[0]-strengths[1])/10;
    }
    const statRows=await this.store.all('SELECT fs.payload,fx.home_team_id,fx.away_team_id,fx.starts_at FROM fixture_statistics fs JOIN fixtures fx ON fx.id=fs.fixture_id WHERE (fx.home_team_id IN (?,?) OR fx.away_team_id IN (?,?)) AND fx.starts_at<? ORDER BY fx.starts_at DESC LIMIT 30',f.home.id,f.away.id,f.home.id,f.away.id,f.startsAt);
    const xg=[f.home.id,f.away.id].map(teamId=>{
      const values=statRows.flatMap(row=>JSON.parse(row.payload).filter(t=>namespace(f.provider,t.team?.id)===teamId).map(t=>t.statistics?.find(v=>v.type==='expected_goals')?.value)).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).slice(0,10).map(Number);
      return values.length>=3?values.reduce((a,b)=>a+b,0)/values.length:null;
    });
    const globalHistory=(await this.store.all("SELECT payload FROM fixtures WHERE provider=? AND starts_at<? AND status IN ('FT','AET','PEN','FINISHED') ORDER BY starts_at DESC LIMIT 3000",f.provider,f.startsAt)).map(r=>JSON.parse(r.payload));
    const competitionTeams=new Set(globalHistory.filter(g=>g.competition.id===f.competition.id).flatMap(g=>[g.home.id,g.away.id]));
    const crossCompetition=globalHistory.some(g=>g.competition.id!==f.competition.id&&(competitionTeams.has(g.home.id)||competitionTeams.has(g.away.id)));
    const ratings=elo(globalHistory,f.startsAt);
    const competitionStrength=crossCompetition&&competitionTeams.size>=4?[...competitionTeams].reduce((sum,id)=>sum+(ratings.get(id)??1500),0)/(competitionTeams.size*1500):null;
    const prediction=project(f,history,{availability,playerPerformance:means.every(v=>v!==null)?(means[0]-means[1])/10:null,lineupStrength,expectedGoals:xg.every(v=>v!==null)?xg:null,competitionStrength});
    prediction.lineupEvidence=confirmedRow?'Confirmed':'Mnemba Tips model estimate';
    if(prediction.label==='Unavailable') return prediction;
    const latest=await this.store.one('SELECT payload FROM model_predictions WHERE fixture_id=? ORDER BY created_at DESC LIMIT 1',f.id);
    const payload=JSON.stringify(prediction);
    if(!latest || latest.payload!==payload) await this.store.upsert('model_predictions',{id:crypto.randomUUID(),fixture_id:f.id,model_version:prediction.modelVersion,created_at:this.store.now(),kickoff_at:f.startsAt,label:prediction.label,payload});
    return prediction;
  }
  async evaluateFixture(f) {
    const rows=await this.store.all('SELECT * FROM model_predictions WHERE fixture_id=? AND created_at<?',f.id,f.startsAt);
    for(const row of rows) { const result=evaluate(JSON.parse(row.payload),f); if(result) await this.store.upsert('prediction_results',{id:row.id,fixture_id:f.id,evaluated_at:this.store.now(),brier_score:result.brier,correct:Number(result.correct),payload:JSON.stringify(result)}); }
  }
  async provider(name,path,params,category) {
    const backoff=await this.store.cache(`backoff:${name}`);
    if(backoff&&!backoff.stale) throw new Error(`${name} backoff active`);
    if(!this.providers[name])throw new Error('This provider does not offer live records');
    return this.providers[name].request(path,params,this.manual?'retry':category);
  }
  async catalog(name) {
    const body=await this.provider(name,name==='api-football'?'leagues':'competitions',{},'statistics');
    const rows=name==='api-football'?body.response:body.competitions;
    if(!Array.isArray(rows)) throw new Error('Invalid competition list');
    for(const row of rows) await this.saveCompetition(normalizeCompetition(name,row));
    return rows.length;
  }
  async countries(name) {
    const body=await this.provider(name,name==='api-football'?'countries':'areas',{},'statistics');
    const rows=name==='api-football'?body.response:body.areas;
    if(!Array.isArray(rows)) throw new Error('Invalid country list');
    const byId=new Map(rows.map(r=>[r.id,r]));
    for(const c of rows) {
      let parent=byId.get(c.parentAreaId),continent=null;
      for(let i=0;parent&&i<8;i++,parent=byId.get(parent.parentAreaId)) if(['Europe','Africa','Asia','Oceania','North America','South America'].includes(parent.name)) continent=parent.name;
      const id=namespace(name,c.code||c.id||c.name);
      const country={id,name:c.name,code:c.code??c.countryCode??null,continent,provider:name,externalId:String(c.code||c.id||c.name)};
      await this.store.upsert('countries',{id,provider:name,external_id:country.externalId,name:c.name,code:country.code,continent,payload:JSON.stringify(country),updated_at:this.store.now()});
      // Cross-provider geography joins use country codes only, never merge sports IDs.
      if(continent) await this.store.run('UPDATE countries SET continent=? WHERE name=? OR (code IS NOT NULL AND code=?)',continent,country.name,country.code);
    }
  }
  async fixtureList(kind) {
    // Prefer the secondary provider for its supported competitions; primary fills global coverage in its own job.
    const name=this.env.API_FOOTBALL_KEY?'api-football':'football-data';
    const day=new Date(this.store.now()).toISOString().slice(0,10);
    const end=new Date(this.store.now()+7*86400000).toISOString().slice(0,10);
    const params=name==='api-football'?(kind==='live'?{live:'all'}:kind==='today'?{date:day}:{next:99}):(kind==='live'?{status:'IN_PLAY'}:{dateFrom:day,dateTo:kind==='today'?day:end});
    try {
      const body=await this.provider(name,name==='api-football'?'fixtures':'matches',params,kind==='live'?'live':'fixtures');
      await this.saveFixtures((name==='api-football'?body.response:body.matches??[]).map(r=>normalizeFixture(name,r)));
    } catch(error) {
      if(name!=='api-football'||!this.env.FOOTBALL_DATA_KEY) throw error;
      const body=await this.provider('football-data','matches',kind==='live'?{status:'IN_PLAY'}:{dateFrom:day,dateTo:kind==='today'?day:end},'fixtures');
      await this.saveFixtures((body.matches??[]).map(r=>normalizeFixture('football-data',r)));
      await this.store.putCache('primary-fallback',{reason:error.name==='QuotaError'?'quota-exhausted':'unavailable',using:'football-data',coverage:'Supported competitions only'},21600000);
    }
  }
  async seasonJob(kind,seasonId) {
    const row=await this.store.one('SELECT s.*,c.provider,c.external_id FROM seasons s JOIN competitions c ON c.id=s.competition_id WHERE s.id=?',seasonId);
    if(!row) throw new Error('Unknown season');
    if(!this.providers[row.provider])return{label:'Historical',unavailable:kind!=='calendar'};
    const api=row.provider==='api-football', params={league:row.external_id,season:row.year};
    let path;
    if(api) path={calendar:'fixtures',standings:'standings',teams:'teams',players:'players',scorers:'players/topscorers',statistics:'teams/statistics'}[kind];
    else path=`competitions/${encodeURIComponent(row.external_id)}/${({calendar:'matches',teams:'teams',standings:'standings',scorers:'scorers',players:'teams',statistics:'standings'})[kind]}`;
    if(!path) throw new Error('Unknown season job');
    const coverage=JSON.parse(row.coverage);
    if(api&&((kind==='standings'&&coverage.standings===false)||(kind==='players'&&coverage.players===false)||(kind==='scorers'&&coverage.top_scorers===false))) return {unavailable:true};
    if(kind==='statistics'&&api) {
      const cursor=await this.store.cache(`cursor:statistics:${seasonId}`);
      const teams=await this.store.all('SELECT t.external_id,t.id FROM football_teams t JOIN season_teams st ON st.team_id=t.id WHERE st.season_id=? ORDER BY t.id',seasonId);
      if(!teams.length) return {unavailable:true};
      const t=teams[(cursor?.data??0)%teams.length]; params.team=t.external_id;
      await this.store.putCache(`cursor:statistics:${seasonId}`,(cursor?.data??0)+1,86400000);
    }
    if(kind==='players'&&api) { const cursor=await this.store.cache(`cursor:players:${seasonId}`); params.page=cursor?.data??1; }
    const body=await this.provider(row.provider,path,api?params:{season:row.year},kind==='calendar'?'fixtures':'statistics');
    if(kind==='calendar') await this.saveFixtures((api?body.response:body.matches??[]).map(r=>normalizeFixture(row.provider,r)));
    if(kind==='teams'||(!api&&kind==='players')) for(const raw of api?body.response:body.teams??[]) {
      const t=api?raw.team:raw;
      const team={id:namespace(row.provider,t.id),provider:row.provider,externalId:String(t.id),name:t.name,logo:t.logo??t.crest??null};
      await this.saveTeam(team,seasonId);
      for(const p of t.squad??[]) await this.savePlayer(row.provider,p,team.id,{});
    }
    if(kind==='players'&&api) {
      for(const raw of body.response) { const stat=raw.statistics?.find(s=>String(s.league?.id)===row.external_id)??raw.statistics?.[0]??{}; if(stat.team?.id) { const team={id:namespace(row.provider,stat.team.id),provider:row.provider,externalId:String(stat.team.id),name:stat.team.name}; await this.saveTeam(team,seasonId); await this.savePlayer(row.provider,raw.player,team.id,stat); } }
      await this.store.putCache(`cursor:players:${seasonId}`,body.paging?.current<body.paging?.total?body.paging.current+1:1,86400000);
    }
    if(kind==='standings') await this.store.upsert('standings',{id:seasonId,season_id:seasonId,label:'Confirmed',payload:JSON.stringify(api?body.response:body.standings??[]),updated_at:this.store.now()});
    if(['scorers','statistics'].includes(kind)) await this.store.putCache(`${kind}:${seasonId}`,{label:'Confirmed',data:api?body.response:body.scorers??body.standings??[]},INTERVALS[kind]);
    return body.paging??null;
  }
  async savePlayer(provider,p,teamId,stat) {
    const position={Goalkeeper:'GK',Defender:'DEF',Midfielder:'MID',Attacker:'FWD',Offence:'FWD',Defence:'DEF'}[stat.games?.position??p.position]??p.position??null;
    const player={id:namespace(provider,p.id),provider,externalId:String(p.id),teamId,name:p.name,position,minutes:stat.games?.minutes??null,rating:stat.games?.rating==null?null:Number(stat.games.rating),availability:p.injured===true?'injured':'unknown',statistics:stat};
    await this.store.upsert('football_players',{id:player.id,provider,external_id:player.externalId,team_id:teamId,name:p.name,payload:JSON.stringify(player),updated_at:this.store.now()});
    const existing=await this.store.one('SELECT payload FROM player_form WHERE id=?',player.id);
    if(!existing||!JSON.parse(existing.payload).recentGames)await this.store.upsert('player_form',{id:player.id,label:player.rating===null?'Unavailable':'Historical',payload:JSON.stringify({minutes:player.minutes,rating:player.rating,scope:'Provider season aggregate; recent-match split unavailable'}),updated_at:this.store.now()});
  }
  async matchJob(kind,id) {
    const row=await this.store.one('SELECT payload FROM fixtures WHERE id=?',id);
    if(!row) throw new Error('Unknown fixture');
    const f=JSON.parse(row.payload),api=f.provider==='api-football';
    if(f.provider==='statsbomb') {
      if(!['events','lineups','statistics','detail'].includes(kind))return{unavailable:true};
      const resource=kind==='lineups'?'lineups':'events';
      const response=await this.fetcher(`https://raw.githubusercontent.com/statsbomb/open-data/master/data/${resource}/${f.externalId}.json`,{signal:AbortSignal.timeout(15000),redirect:'manual'});
      if(!response.ok)throw new Error('StatsBomb match detail unavailable');
      const rows=await response.json();
      f.sourceUrl=`https://raw.githubusercontent.com/statsbomb/open-data/master/data/${resource}/${f.externalId}.json`;
      if(resource==='lineups'){const normalized=statsBombLineups(rows,f);for(const team of normalized)for(const player of team.players){const stat={games:{minutes:player.minutes,rating:null,position:player.position,substitute:!player.started},positions:player.positions,sourceUrl:f.sourceUrl};await this.savePlayer('statsbomb',{id:player.externalId,name:player.name,position:player.position},team.teamId,stat);if(player.positions.length>0)await this.store.upsert('football_appearances',{id:`${f.id}|${player.id}`,fixture_id:f.id,player_id:player.id,minutes:player.minutes,rating:null,payload:JSON.stringify(stat),updated_at:this.store.now()});}await this.detailRecord('lineups',f,normalized);}
      else {
        const events=rows.filter(e=>e.type?.name==='Substitution'||e.bad_behaviour?.card||e.foul_committed?.card||e.shot?.outcome?.name==='Goal').map(e=>({minute:e.minute,second:e.second,team:e.team?.name,player:e.player?.name,type:e.type?.name,detail:e.shot?.outcome?.name??e.bad_behaviour?.card?.name??e.foul_committed?.card?.name??e.substitution?.replacement?.name}));
        await this.detailRecord('fixture_events',f,events);
        const statistics=[f.home,f.away].map(t=>{const shots=rows.filter(e=>e.team?.id===Number(t.externalId)&&e.type?.name==='Shot');return{team:t.name,shots:shots.length,expectedGoals:shots.reduce((sum,e)=>sum+(e.shot?.statsbomb_xg??0),0),label:'Historical',attribution:'Calculated from StatsBomb Open Data shot events'};});
        await this.detailRecord('fixture_statistics',f,statistics);
        const whistles=rows.filter(e=>e.type?.name==='Half End'&&e.period<=4).sort((a,b)=>b.period-a.period||b.minute-a.minute||b.second-a.second),finalClock=whistles.length?whistles[0].minute*60+whistles[0].second:null;
        const sheet=await this.store.one('SELECT payload FROM lineups WHERE fixture_id=?',f.id);
        for(const team of JSON.parse(sheet?.payload??'[]'))for(const player of team.players??[]){if(!player.id||!player.positions?.length)continue;const minutes=positionMinutes(player.positions,finalClock),goals=rows.filter(e=>String(e.player?.id)===player.externalId&&e.type?.name==='Shot'&&e.shot?.outcome?.name==='Goal').length,assists=rows.filter(e=>String(e.player?.id)===player.externalId&&e.pass?.goal_assist===true).length;
         const stat={games:{minutes,position:player.position,substitute:!player.started,rating:null},positions:player.positions,goals:{total:goals,assists},sourceUrls:[`https://raw.githubusercontent.com/statsbomb/open-data/master/data/lineups/${f.externalId}.json`,f.sourceUrl],minutesBasis:'Derived from position and final-whistle clocks; not an official minute total'};
         await this.store.upsert('football_appearances',{id:`${f.id}|${player.id}`,fixture_id:f.id,player_id:player.id,minutes,rating:null,payload:JSON.stringify(stat),updated_at:this.store.now()});
         if(this.evidence)await this.evidence.claims(`${f.id}|${player.id}`,'appearance','statsbomb',f.sourceUrl,{minutes,goals,assists,supportingSources:stat.sourceUrls},{confidence:.85,verification:'derived',expiresIn:3650*86400000});
        }

      }
      return{label:'Historical'};
    }
    if(f.provider==='openfootball')return{unavailable:true};
    if(!api && !['selected','detail'].includes(kind)) return {unavailable:true};
    if(kind==='selected'||kind==='detail') {
      const body=await this.provider(f.provider,api?'fixtures':`matches/${f.externalId}`,api?{id:f.externalId}:{},'details');
      const raw=api?body.response[0]:body;
      if(!raw) throw new Error('Fixture unavailable');
      await this.saveFixtures([normalizeFixture(f.provider,raw)]);
      if(api) for(const [key,table] of [['events','fixture_events'],['statistics','fixture_statistics'],['lineups','lineups']]) if(Array.isArray(raw[key])) await this.detailRecord(table,f,raw[key]);
    } else if(kind==='player-statistics') {
      const body=await this.provider(f.provider,'fixtures/players',{fixture:f.externalId},'details');
      for(const teamRow of body.response) {
        const teamId=namespace(f.provider,teamRow.team.id);
        if(![f.home.id,f.away.id].includes(teamId))continue;
        for(const row of teamRow.players??[]) {
          const stat=row.statistics?.[0]??{};
          await this.savePlayer(f.provider,row.player,teamId,stat);
          const playerId=namespace(f.provider,row.player.id);
          await this.store.upsert('football_appearances',{id:`${f.id}|${playerId}`,fixture_id:f.id,player_id:playerId,minutes:stat.games?.minutes??null,rating:stat.games?.rating==null?null:Number(stat.games.rating),payload:JSON.stringify(stat),updated_at:this.store.now()});
          const recent=await this.store.all('SELECT a.minutes,a.rating,fx.starts_at FROM football_appearances a JOIN fixtures fx ON fx.id=a.fixture_id WHERE a.player_id=? ORDER BY fx.starts_at DESC LIMIT 10',playerId);
          await this.store.upsert('player_form',{id:playerId,label:FINAL.has(f.status)?'Historical':f.label,payload:JSON.stringify({recentGames:recent,scope:'Last ten recorded match appearances'}),updated_at:this.store.now()});
        }
      }
      // New player evidence updates any upcoming fixtures involving either team.
      const upcoming=await this.store.all('SELECT payload FROM fixtures WHERE (home_team_id IN (?,?) OR away_team_id IN (?,?)) AND starts_at>? ORDER BY starts_at LIMIT 30',f.home.id,f.away.id,f.home.id,f.away.id,this.store.now());
      for(const row of upcoming)await this.predict(JSON.parse(row.payload));
    } else if(['events','statistics','lineups','injuries','provider-prediction'].includes(kind)) {
      const coverage=await this.store.one('SELECT coverage FROM seasons WHERE id=?',f.seasonId);
      const flags=JSON.parse(coverage?.coverage??'{}');
      const supported=kind==='injuries'?flags.injuries:kind==='provider-prediction'?flags.predictions:flags.fixtures?.[kind==='statistics'?'statistics_fixtures':kind];
      if(supported===false) return {unavailable:true};
      const path=kind==='injuries'?'injuries':kind==='provider-prediction'?'predictions':`fixtures/${kind}`;
      const body=await this.provider(f.provider,path,{fixture:f.externalId},'details');
      if(kind==='provider-prediction') await this.store.putCache(`provider-prediction:${id}`,{label:body.response.length?'Provider prediction':'Unavailable',data:body.response},21600000);
      else await this.detailRecord(({events:'fixture_events',statistics:'fixture_statistics',lineups:'lineups',injuries:'injuries'})[kind],f,body.response);
      await this.predict(f);
    } else if(kind==='h2h') {
      if(!api) return {unavailable:true};
      const body=await this.provider(f.provider,'fixtures/headtohead',{h2h:`${f.home.externalId}-${f.away.externalId}`,last:20},'details');
      await this.saveFixtures(body.response.map(r=>normalizeFixture(f.provider,r)));
    }
  }
  async detailRecord(table,f,data) { await this.store.upsert(table,{id:f.id,fixture_id:f.id,label:data.length?(f.provider==='statsbomb'?'Historical':table==='lineups'?'Confirmed':table==='injuries'?'Confirmed':f.label):'Unavailable',payload:JSON.stringify(data),updated_at:this.store.now()}); }
  async job(key,force=false) {
    const split=key.indexOf(':'),kind=split<0?key:key.slice(0,split),arg=split<0?'':key.slice(split+1);
    const ttl=INTERVALS[kind]??21600000;
    const cache=await this.store.cache(`job:${key}`);
    if(cache&&!cache.stale&&(!force||this.store.now()-cache.updatedAt<300000)) return {status:'cached',nextAt:cache.updatedAt+ttl};
    if(kind==='catalog'||kind==='countries') { if(!this.providers[arg]?.key) return {status:'not-configured'}; }
    if(['today','upcoming','live'].includes(kind)&&!this.env.API_FOOTBALL_KEY&&!this.env.FOOTBALL_DATA_KEY) return {status:'not-configured'};
    // One global lease also prevents separate browser tabs and worker instances spending concurrently.
    const owner=await this.store.lock('football-sync',300000);
    if(!owner) return {status:'busy'};
    const recheck=await this.store.cache(`job:${key}`);
    if(recheck&&!recheck.stale&&(!force||this.store.now()-recheck.updatedAt<300000)) {await this.store.unlock('football-sync',owner);return{status:'cached'};}
    const renewal=setInterval(()=>{this.store.run('UPDATE sync_locks SET expires_at=? WHERE id=? AND owner=?',this.store.now()+300000,'football-sync',owner).catch(()=>{});},60000);
    const id=crypto.randomUUID(),provider=this.providers[arg.split(':')[0]]?arg.split(':')[0]:['today','upcoming','live'].includes(kind)?(this.env.API_FOOTBALL_KEY?'api-football':'football-data'):kind==='news'?'rss':'historical';
    this.manual=force;
    await this.store.run('INSERT INTO provider_sync_runs(id,provider,job,status,started_at) VALUES(?,?,?,?,?)',id,provider,key,'running',this.store.now());
    try {
      let result;
      if(kind==='catalog') result=await this.catalog(arg);
      else if(kind==='countries') result=await this.countries(arg);
      else if(['today','upcoming','live'].includes(kind)) result=await this.fixtureList(kind);
      else if(['calendar','teams','standings','scorers','players','statistics'].includes(kind)&&arg.includes(':')&&!(await this.store.one('SELECT id FROM fixtures WHERE id=?',arg))) result=await this.seasonJob(kind,arg);
      else if(kind==='news') result=await syncNews(this.store,{...this.options,newsKey:this.env.NEWS_API_KEY,development:this.env.NODE_ENV==='development'});
      else if(kind==='historical') result=await this.historical();
      else if(kind==='history-import') result=await this.importHistory(arg);
      else result=await this.matchJob(kind,arg);
      await this.store.putCache(`job:${key}`,{status:'success',result:result??null},kind==='lineups'||force?Math.min(ttl,300000):ttl);
      await this.store.run('UPDATE provider_sync_runs SET status=?,finished_at=? WHERE id=?','success',this.store.now(),id);
      return {status:'success',job:key};
    } catch(error) {
      const message=error instanceof Error?error.message:'Synchronization failed';
      const status=error?.name==='QuotaError'?'quota-exhausted':'unavailable';
      await this.store.putCache(`job:${key}`,{status,error:message},status==='quota-exhausted'?Math.max(1,Date.parse(this.store.day())+86400000-this.store.now()):300000);
      await this.store.run('UPDATE provider_sync_runs SET status=?,finished_at=?,error=? WHERE id=?',status,this.store.now(),message,id);
      return {status,error:message,job:key};
    } finally { this.manual=false; clearInterval(renewal); await this.store.unlock('football-sync',owner); }
  }
  async tick(context) {
    const fixtures=(await this.store.all('SELECT payload FROM fixtures WHERE starts_at BETWEEN ? AND ?',this.store.now()-86400000,this.store.now()+86400000)).map(r=>JSON.parse(r.payload));
    const jobs=dueJobs({...context,now:this.store.now(),fixtures});
    if(context.visible) jobs.push(...(await this.store.all("SELECT DISTINCT job FROM provider_sync_runs WHERE job LIKE 'history-import:%' AND status='success' LIMIT 50")).map(r=>r.job));
    for(const job of jobs) {
      const result=await this.job(job);
      if(!['cached','not-configured'].includes(result.status)) return result;
    }
    return {status:'idle'};
  }
  async historical() {
    // Catalog is dynamic; historical ingestion itself is selected on demand to avoid downloading entire archives.
    const url='https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json';
    const catalog=[],errors=[];
    try {
      const response=await this.fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'manual'});
      if(!response.ok) throw new Error('StatsBomb historical catalog unavailable');
      const rows=await response.json();
      if(!Array.isArray(rows)) throw new Error('Invalid StatsBomb catalog');
      catalog.push(...rows.map(r=>({key:`statsbomb:${r.competition_id}:${r.season_id}`,provider:'statsbomb',competitionId:r.competition_id,seasonId:r.season_id,name:r.competition_name,season:r.season_name,country:r.country_name,gender:r.competition_gender})));
    } catch(error) {errors.push(`StatsBomb unavailable: ${error.message}`);}
    try {
      const response=await this.fetcher('https://api.github.com/repos/openfootball/football.json/git/trees/master?recursive=1',{headers:{'User-Agent':'Mnemba Tips-local'},signal:AbortSignal.timeout(15000),redirect:'manual'});
      if(!response.ok)throw new Error('OpenFootball catalog unavailable');
      const body=await response.json();
      for(const item of body.tree??[]) {
        const match=item.path.match(/^(\d{4}-\d{2})\/([a-z0-9_.-]+)\.json$/i);
        if(match)catalog.push({key:`openfootball:${match[2]}:${match[1]}`,provider:'openfootball',competitionId:match[2],seasonId:match[1],name:match[2],season:match[1],path:item.path});
      }
    }catch(error) {errors.push(`OpenFootball unavailable: ${error.message}`);}
    if(!catalog.length)throw new Error(errors.join('; '));
    await this.store.putCache('historical-catalog',catalog,604800000);
    return {count:catalog.length,errors,attribution:'StatsBomb Open Data and OpenFootball (public domain)'};
  }
  async importHistory(key) {
    const catalog=(await this.store.cache('historical-catalog'))?.data??[];
    const entry=catalog.find(e=>e.key===key);
    if(!entry)throw new Error('Select a returned historical competition-season');
    const url=entry.provider==='statsbomb'?`https://raw.githubusercontent.com/statsbomb/open-data/master/data/matches/${entry.competitionId}/${entry.seasonId}.json`:`https://raw.githubusercontent.com/openfootball/football.json/master/${entry.path}`;
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'manual'});
    if(!response.ok)throw new Error('Historical records unavailable');
    const body=await response.json();
    const fixtures=entry.provider==='statsbomb'?normalizeStatsBomb(body,entry):normalizeOpenHistory(body,entry);
    await this.saveFixtures(fixtures);
    return {count:fixtures.length,label:'Historical',provider:entry.provider};
  }
  async read(params) {
    const s=this.store, view=params.get('view')??'fixtures';
    if(view==='diagnostics') return {budget:await s.budget(),providers:await Promise.all(Object.entries(this.providers).map(async([name,p])=>({name,configured:!!p.key,lastRun:await s.one('SELECT job,status,finished_at,error FROM provider_sync_runs WHERE provider=? OR job=? ORDER BY started_at DESC LIMIT 1',name,`catalog:${name}`)}))),runs:await s.all('SELECT * FROM provider_sync_runs ORDER BY started_at DESC LIMIT 30'),news:(await s.cache('news-status'))?.data??[],accuracy:await s.one('SELECT COUNT(*) evaluated,AVG(brier_score) brier,AVG(correct) accuracy FROM prediction_results'),historical:(await s.cache('historical-catalog'))?.data??[]};
    if(view==='catalog') {
      const countries=await s.all('SELECT id,name,code,continent FROM countries ORDER BY name');
      const competitions=(await s.all('SELECT c.payload,(SELECT COUNT(*) FROM fixtures f WHERE f.competition_id=c.id) fixtureCount FROM competitions c ORDER BY c.name')).map(r=>({...JSON.parse(r.payload),fixtureCount:r.fixtureCount}));
      const seasons=(await s.all('SELECT payload FROM seasons ORDER BY year DESC')).map(r=>JSON.parse(r.payload));
      return {countries,competitions:groupCompetitions(competitions),seasons};
    }
    if(view==='news') {
      const query=`%${(params.get('q')??'').slice(0,200)}%`, category=params.get('category')??'';
      return {articles:deduplicate((await s.all('SELECT payload FROM news_articles WHERE (headline LIKE ? OR payload LIKE ?) AND (?=\'\' OR category=?) ORDER BY published_at DESC LIMIT 300',query,query,category,category)).map(r=>{const a=JSON.parse(r.payload);return {...a,headline:cleanText(a.headline),summary:cleanText(a.summary)};})),freshness:await s.cache('job:news')};
    }
    if(view==='search') {
      const query=`%${(params.get('q')??'').slice(0,200)}%`;
      return {teams:(await s.all('SELECT t.payload,f.payload AS form FROM football_teams t LEFT JOIN team_form f ON f.id=t.id WHERE t.name LIKE ? ORDER BY t.name LIMIT 100',query)).map(r=>({...JSON.parse(r.payload),form:r.form?JSON.parse(r.form):null})),players:(await s.all('SELECT p.payload,f.payload AS form FROM football_players p LEFT JOIN player_form f ON f.id=p.id WHERE p.name LIKE ? ORDER BY p.name LIMIT 100',query)).map(r=>({...JSON.parse(r.payload),recentForm:r.form?JSON.parse(r.form):null}))};
    }
    if(view==='match') {
      const row=await s.one('SELECT * FROM fixtures WHERE id=?',params.get('id')??'');
      if(!row) return {unavailable:true};
      const fixture=JSON.parse(row.payload), details={};
      for(const table of ['fixture_events','fixture_statistics','lineups','injuries']) { const data=await s.one(`SELECT * FROM ${table} WHERE fixture_id=?`,fixture.id); details[table]=data?{label:data.label,data:JSON.parse(data.payload),updatedAt:data.updated_at}:{label:'Unavailable',data:[]}; }
      const history=await this.history(fixture.home.id,fixture.away.id);
      const players=(await s.all('SELECT payload FROM football_players WHERE team_id IN (?,?)',fixture.home.id,fixture.away.id)).map(r=>JSON.parse(r.payload));
      for(const player of players) {const injury=details.injuries.data.find(i=>namespace(fixture.provider,i.player?.id)===player.id);if(injury)player.availability=/suspend|red card|yellow card/i.test(injury.player?.reason??'')?'suspended':/doubt/i.test(injury.player?.type??'')?'doubtful':'injured';}
      const h2h=headToHead(history,fixture.home.id,fixture.away.id,fixture.startsAt);
      const latest=await s.one('SELECT payload,created_at FROM model_predictions WHERE fixture_id=? ORDER BY created_at DESC LIMIT 1',fixture.id);
      return {fixture,updatedAt:row.updated_at,details,h2h,forms:[fixture.home.id,fixture.away.id].map(id=>({overall:form(history,id,fixture.startsAt),home:form(history,id,fixture.startsAt,'home'),away:form(history,id,fixture.startsAt,'away')})),players,projectedLineups:[fixture.home.id,fixture.away.id].map(id=>predictedLineup(players.filter(p=>p.teamId===id))),prediction:latest?{...JSON.parse(latest.payload),createdAt:latest.created_at}:{label:'Unavailable',reason:'No eligible pre-kickoff prediction stored'},providerPrediction:(await s.cache(`provider-prediction:${fixture.id}`))?.data??{label:'Unavailable'},standings:await s.one('SELECT * FROM standings WHERE season_id=?',fixture.seasonId),scorers:(await s.cache(`scorers:${fixture.seasonId}`))?.data??null};
    }
    const clauses=[],args=[];
    for(const [param,column] of [['competition','f.competition_id'],['season','f.season_id'],['status','f.status'],['country','c.country_id']]) if(params.get(param)) { const values=params.get(param).split(',').slice(0,30);clauses.push(`${column} IN (${values.map(()=>'?').join(',')})`);args.push(...values); }
    if(params.get('q')){clauses.push("(json_extract(f.payload,'$.home.name') LIKE ? OR json_extract(f.payload,'$.away.name') LIKE ? OR c.name LIKE ?)");const q='%'+params.get('q').slice(0,100)+'%';args.push(q,q,q);}
    if(params.get('confederation')){clauses.push("COALESCE(json_extract(c.payload,'$.confederation'),json_extract(c.payload,'$.country.confederation'))=?");args.push(params.get('confederation'));}
    if(params.get('continent')) {clauses.push('co.continent=?');args.push(params.get('continent'));}
    if(params.get('team')) {clauses.push('(f.home_team_id=? OR f.away_team_id=?)');args.push(params.get('team'),params.get('team'));}
    for(const [param,op] of [['from','>='],['to','<=']]) if(params.get(param)) {const bounds=dayBounds(params.get(param),params.get('timezone')??'UTC');const date=param==='to'?bounds.end-1:bounds.start;if(!Number.isFinite(date))throw new Error('Invalid date');clauses.push(`((COALESCE(json_extract(f.payload,'$.kickoffPrecision'),'instant')!='date' AND f.starts_at${op}?) OR (json_extract(f.payload,'$.kickoffPrecision')='date' AND f.starts_at${op}?))`);args.push(date,Date.parse(params.get(param))+(param==='to'?86399999:0));}
    const offset=Math.max(0,Math.min(1000000,parseInt(params.get('offset')??'0',10)||0));
    const rows=await s.all(`SELECT f.payload,f.updated_at FROM fixtures f JOIN competitions c ON c.id=f.competition_id LEFT JOIN countries co ON co.id=c.country_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY f.starts_at LIMIT 500 OFFSET ?`,...args,offset);
    return {fixtures:rows.map(r=>({...JSON.parse(r.payload),updatedAt:r.updated_at})),limit:500,nextOffset:rows.length===500?offset+500:null,freshness:await s.cache('job:today')};
  }
}
