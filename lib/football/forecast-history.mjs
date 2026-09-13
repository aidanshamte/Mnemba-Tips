import {matchState} from './match-state.mjs';
export function topPick(values){if(!Array.isArray(values)||!values.length)return null;const max=Math.max(...values),indices=values.map((v,i)=>Math.abs(v-max)<1e-12?i:-1).filter(i=>i>=0);return indices.length===1?indices[0]:null;}
export function compareForecast(payload,home,away){const outcome=home>away?0:home===away?1:2,pick=topPick(payload.probabilities),cells=payload.distribution??[],best=cells.length?Math.max(...cells.map(c=>c.probability)):null,top=cells.filter(c=>Math.abs(c.probability-best)<1e-12),score=top.length===1?top[0]:null;return{outcome,resultPick:pick,resultCorrect:pick===null?null:pick===outcome,resultTied:pick===null,exactScorePick:score?{home:score.home,away:score.away}:null,exactScoreCorrect:score?score.home===home&&score.away===away:null,exactScoreTied:top.length>1};}
export async function archiveFor(service,f){
 const s=service.store,identity=await s.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',f.id),ids=identity?(await s.all('SELECT fixture_id FROM fixture_identities WHERE canonical_id=?',identity.canonical_id)).map(r=>r.fixture_id):[f.id],marks=ids.map(()=>'?').join(',');
 const rows=await s.all(`SELECT p.*,g.payload grade,g.outcome FROM analysis_forecasts p LEFT JOIN analysis_grades g ON g.id=p.id WHERE p.fixture_id IN (${marks}) ORDER BY p.as_of,CASE WHEN p.model_version='poisson-temporal-1' THEN 0 ELSE 1 END,p.id`,...ids);
 const versions=[];for(const r of rows){const audit=await s.one('SELECT state,payload FROM analysis_grade_audit WHERE forecast_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1',r.id);versions.push({id:r.id,fixtureId:r.fixture_id,modelVersion:r.model_version,createdAt:r.as_of,kickoffAt:r.kickoff_at,scope:'Regulation time, 90 minutes plus stoppage time',payload:JSON.parse(r.payload),grade:r.grade?JSON.parse(r.grade):null,gradeState:audit?.state??'pending',gradeReason:audit?JSON.parse(audit.payload).reason:null,eligible:r.as_of<r.kickoff_at&&r.max_known_at<=r.as_of});}
 const runtime=await s.one("SELECT model_version FROM model_runtime WHERE id='primary'"),primary=runtime?.model_version??'poisson-temporal-1';
 const matching=versions.filter(v=>v.eligible&&v.modelVersion===primary&&v.kickoffAt===f.startsAt),selected=matching.at(-1)??versions.filter(v=>v.modelVersion==='poisson-temporal-1').at(-1)??versions[0]??null;
 const exploratory=(await s.all(`SELECT id,as_of,payload FROM exploratory_estimates WHERE fixture_id IN (${marks}) ORDER BY as_of DESC LIMIT 30`,...ids)).map(r=>({id:r.id,createdAt:r.as_of,payload:JSON.parse(r.payload)}));
 return{original:versions[0]??null,selected,versions,exploratory,selectionRule:'Latest eligible pre-kickoff version per canonical fixture and model with the final verified kickoff. Other versions remain archived.',matchState:matchState(f,s.now())};
}

export async function publicHistory(service,params){
 const s=service.store,offset=Math.max(0,Number(params.get('offset'))||0),limit=20;
 const rows=await s.all(`SELECT MIN(f.id) id,MAX(p.as_of) saved_at FROM analysis_forecasts p JOIN fixtures f ON f.id=p.fixture_id LEFT JOIN fixture_identities i ON i.fixture_id=f.id GROUP BY COALESCE(i.canonical_id,f.id) ORDER BY saved_at DESC LIMIT ? OFFSET ?`,limit+1,offset);
 const matches=[];for(const row of rows.slice(0,limit)){const f=JSON.parse((await s.one('SELECT payload FROM fixtures WHERE id=?',row.id)).payload);matches.push({fixture:f,archive:await archiveFor(service,f)});}
 return{matches,nextOffset:rows.length>limit?offset+limit:null,note:'Immutable pre-kickoff forecasts only. Exploratory date-only previews are kept separately on each match. Tied top picks are excluded from pick accuracy; extra time and shootouts are excluded.'};
}
