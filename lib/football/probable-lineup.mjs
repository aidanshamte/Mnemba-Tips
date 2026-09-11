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
export async function lineupContext(store,fixture){
 if(fixture.startsAt<=store.now())return [];
 const availability=await store.all('SELECT payload FROM injuries WHERE fixture_id=? AND updated_at<=?',fixture.id,store.now());
 const unavailable=availability.flatMap(r=>JSON.parse(r.payload)).map(v=>v.player?.id!=null?`${fixture.provider}:${v.player.id}`:v.playerId).filter(Boolean);
 const results=[];for(const team of [fixture.home,fixture.away]){
 const rows=await store.all("SELECT l.payload,l.updated_at,f.starts_at,f.payload fixture FROM lineups l JOIN fixtures f ON f.id=l.fixture_id WHERE (f.home_team_id=? OR f.away_team_id=?) AND f.starts_at<? AND l.updated_at<=? ORDER BY f.starts_at DESC LIMIT 5",team.id,team.id,store.now(),store.now());
 const sheets=rows.flatMap(r=>JSON.parse(r.payload).filter(s=>s.teamId===team.id).map(s=>({players:s.players,kickoff:r.starts_at,retrievedAt:r.updated_at,sourceUrl:JSON.parse(r.fixture).sourceUrl})));
 results.push({team,...probableLineup(sheets,{asOf:store.now(),unavailable})});}return results;
}
