import {matchState,analysisCutoff} from './match-state.mjs';
// Participation-based estimate. Current membership alone never implies selection.
export function probableLineup(sheets,{asOf,unavailable=[]}={}){
 const usable=sheets.filter(s=>s.kickoff<asOf&&s.retrievedAt<=asOf&&Array.isArray(s.players)).sort((a,b)=>b.kickoff-a.kickoff).slice(0,5);
 const base={label:'Estimated',method:'Recency-weighted starting frequency in recorded team sheets; uncalibrated selection estimate',matches:usable.length,asOf,availability:'Unknown unless supported by a recorded claim'};
 if(usable.length<3)return {...base,players:[],reason:'At least three team sheets known before the cutoff are required.'};
 const pool=new Map();let total=0;usable.forEach((s,i)=>{const weight=Math.pow(.8,i);total+=weight;for(const p of s.players){if(!p.id||!p.name||!p.started||unavailable.includes(p.id))continue;const old=pool.get(p.id)??{id:p.id,name:p.name,position:p.position,weight:0,sources:[]};old.weight+=weight;old.sources.push(s.sourceUrl);pool.set(p.id,old);}});
 const ranked=[...pool.values()].map(({weight,...p})=>({...p,startingFrequency:weight/total})).sort((a,b)=>b.startingFrequency-a.startingFrequency||a.name.localeCompare(b.name));
 const keeper=ranked.find(p=>p.position==='GK'),outfield=ranked.filter(p=>p.position&&p.position!=='GK').slice(0,10),players=keeper?[keeper,...outfield]:outfield;
 const complete=players.length===11&&!!keeper&&players.filter(p=>p.position==='DEF').length>=3&&players.filter(p=>p.position==='MID').length>=2&&players.some(p=>p.position==='FWD');
 return {...base,players:complete?players:[],reason:complete?'Availability and tactical changes can invalidate this estimate.':'Recorded positions do not support a complete XI; no lineup invented.'};
}
export function normalizeLineups(payload,provider){
 const position=v=>({G:'GK',Goalkeeper:'GK',D:'DEF',Defence:'DEF',M:'MID',Midfield:'MID',F:'FWD',Offence:'FWD'}[v]??v);
 return (Array.isArray(payload)?payload:payload?.response??[]).map(s=>({teamId:s.teamId??(s.team?.id!=null?`${provider}:${s.team.id}`:null),players:(s.players??s.startXI??s.lineup??[]).map(item=>{const p=item.player??item;return{id:typeof p.id==='string'&&p.id.includes(':')?p.id:p.id!=null?`${provider}:${p.id}`:null,name:p.name,position:position(p.position??p.pos),started:item.started??p.started??true};})}));
}
export async function lineupContext(store,fixture){
 const now=store.now(),asOf=analysisCutoff(fixture,now),results=[];
 const current=await store.all('SELECT payload FROM lineups WHERE fixture_id=? AND updated_at<=?',fixture.id,now),confirmed=current.flatMap(r=>normalizeLineups(JSON.parse(r.payload),fixture.provider));
 for(const team of [fixture.home,fixture.away]){
  const sheet=confirmed.find(s=>s.teamId===team.id&&s.players.filter(p=>p.started&&p.id&&p.name).length===11);
  if(sheet){results.push({team,label:'Confirmed',players:sheet.players.filter(p=>p.started),method:'Recorded fixture team sheet',availability:'Provider-confirmed selection',reason:'Selection is separate from the results/form probability baseline.'});continue;}
  if(!matchState(fixture,now).previewAllowed)continue;
  const rows=await store.all("SELECT l.payload,l.updated_at,f.starts_at,f.payload fixture FROM lineups l JOIN fixtures f ON f.id=l.fixture_id WHERE (f.home_team_id=? OR f.away_team_id=?) AND f.starts_at<? AND l.updated_at<=? ORDER BY f.starts_at DESC LIMIT 100",team.id,team.id,asOf,asOf);
  const seen=new Set(),sheets=[];
  for(const r of rows){const f=JSON.parse(r.fixture),key=`${f.startsAt}:${f.home.id}:${f.away.id}`;if(seen.has(key))continue;seen.add(key);for(const s of normalizeLineups(JSON.parse(r.payload),f.provider).filter(s=>s.teamId===team.id))sheets.push({players:s.players,kickoff:r.starts_at,retrievedAt:r.updated_at,sourceUrl:f.sourceUrl});}
  const unavailable=[];
  for(const id of new Set(sheets.flatMap(s=>s.players.map(p=>p.id)).filter(Boolean))){const row=await store.one('SELECT payload FROM football_players WHERE id=?',id);const memberships=row?JSON.parse(row.payload).memberships??[]:[];if(memberships.some(m=>m.teamId===team.id&&m.end&&(typeof m.end==='number'?m.end:Date.parse(m.end))<asOf))unavailable.push(id);}
  const availability=await store.all('SELECT payload FROM injuries WHERE fixture_id=? AND updated_at<=?',fixture.id,asOf);unavailable.push(...availability.flatMap(r=>JSON.parse(r.payload)).map(v=>v.player?.id!=null?`${fixture.provider}:${v.player.id}`:v.playerId).filter(Boolean));
  const estimate=probableLineup(sheets,{asOf,unavailable});if(sheets[0]&&asOf-sheets[0].kickoff>90*86400000){estimate.players=[];estimate.reason='Recorded participation is too old to project a current XI.';}results.push({team,...estimate});
 }return results;
}
