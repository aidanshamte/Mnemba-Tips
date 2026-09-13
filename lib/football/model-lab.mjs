import {originalAnalysis,scoreDistribution} from './temporal.mjs';
import {dixonColes,fitRho,probabilityMetrics} from './dixon-coles.mjs';
import {matchState} from './match-state.mjs';
import {compareForecast} from './forecast-history.mjs';
import {goalMarkets} from './markets.mjs';
import {digest} from './http.mjs';
const probabilities=cells=>cells.reduce((p,c)=>{p[c.home>c.away?0:c.home===c.away?1:2]+=c.probability;return p;},[0,0,0]);
export class ModelLab{
 constructor(service){this.service=service;this.store=service.store;}
 async trainDependence(competitionId){
  const s=this.store,asOf=s.now(),key=`dc:${competitionId}`,cached=await s.one('SELECT * FROM model_parameters WHERE id=?',key);if(cached&&cached.trained_at>asOf-86400000)return JSON.parse(cached.payload);
  const records=await s.all("SELECT f.payload,c.id evidence_id,c.known_at FROM fixtures f JOIN field_claims c ON c.entity_id=f.id AND c.field='fixture' AND c.valid_to IS NULL AND c.training_allowed=1 WHERE f.competition_id=? AND f.starts_at<? AND f.status IN ('FT','FINISHED') AND c.known_at<=?",competitionId,asOf,asOf);
  const history=await this.service.deduplicateFixtures(records.map(r=>({...JSON.parse(r.payload),knownAt:r.known_at,evidenceId:r.evidence_id}))),valid=history.filter(f=>!f.hasConflict&&f.homeScore!=null&&f.awayScore!=null);
  // Joint parameter fitting on the training corpus is not a historical forecast/backtest.
  const weight=f=>Math.exp(-(asOf-f.startsAt)/(365*86400000)),total=valid.reduce((n,f)=>n+weight(f),0),lambda=total?valid.reduce((n,f)=>n+weight(f)*f.homeScore,0)/total:1,mu=total?valid.reduce((n,f)=>n+weight(f)*f.awayScore,0)/total:1;
  const fit=fitRho(valid.map(f=>({homeScore:f.homeScore,awayScore:f.awayScore,playedAt:f.startsAt,knownAt:f.knownAt,lambda:Math.max(.1,lambda),mu:Math.max(.1,mu),trainingAllowed:true})),asOf);
  const result={...fit,competitionId,modelVersion:'dc-candidate-1',trainingCutoff:asOf,evidenceIds:valid.map(f=>f.evidenceId),evaluation:'No prospective superiority established. Poisson remains the primary baseline.'};const parameterId=await digest([key,asOf,result]);await s.run('INSERT OR IGNORE INTO model_parameter_versions(id,model_version,trained_at,payload) VALUES(?,?,?,?)',parameterId,'dc-candidate-1',asOf,JSON.stringify(result));result.parameterId=parameterId;await s.upsert('model_parameters',{id:key,model_version:'dc-candidate-1',trained_at:asOf,training_cutoff:asOf,payload:JSON.stringify(result)});return result;
 }
 async capture(f){
  const s=this.store,asOf=s.now();if(!matchState(f,asOf).previewAllowed)return{state:'skipped',reason:'Not a future scheduled fixture'};
  // Date-only source timestamps are ordering placeholders, not trustworthy timed forecast cutoffs.
  if(f.kickoffPrecision==='date')return{state:'abstained',reason:'Verified kickoff instant required for graded forecasts; exploratory analysis remains available.'};
  if(f.startsAt<=asOf)return{state:'abstained',reason:'Scheduled time has passed; awaiting verified kickoff update'};
  if(await s.one('SELECT id FROM analysis_forecasts WHERE fixture_id=? AND kickoff_at=? AND as_of>?',f.id,f.startsAt,asOf-1800000))return{state:'cached'};
  const claims=await s.all("SELECT c.* FROM field_claims c WHERE c.field='fixture' AND c.known_at<=? AND (c.published_at IS NULL OR c.published_at<=?) AND (c.valid_to IS NULL OR c.valid_to>?)",asOf,asOf,asOf),fixtureClaim=claims.find(c=>c.entity_id===f.id);if(!fixtureClaim)return{state:'abstained',reason:'No eligible current fixture claim'};
  if(await s.one("SELECT c.id FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",f.id))return{state:'abstained',reason:'Unresolved fixture claims'};
  const knownFixture=JSON.parse(fixtureClaim.value_json);if(knownFixture.startsAt!==f.startsAt)return{state:'abstained',reason:'Kickoff conflict'};
  const aliases=await s.all('SELECT provider_id,canonical_id FROM entity_aliases'),canonical=new Map(aliases.map(a=>[a.provider_id,a.canonical_id])),representative=id=>{const key=canonical.get(id)??id;return key===(canonical.get(f.home.id)??f.home.id)?f.home.id:key===(canonical.get(f.away.id)??f.away.id)?f.away.id:key;};
  const history=await this.service.deduplicateFixtures(claims.map(c=>JSON.parse(c.value_json)).filter(g=>g.id!==f.id&&g.startsAt<asOf&&g.startsAt<f.startsAt&&['FT','FINISHED'].includes(g.status)).map(g=>({...g,home:{...g.home,id:representative(g.home.id)},away:{...g.away,id:representative(g.away.id)}}))); const analysis=originalAnalysis(knownFixture,history,{asOf});if(!analysis.probabilities)return{state:'abstained',reason:analysis.reason};
  const usedIds=new Set(history.map(g=>g.id)),used=claims.filter(c=>c.entity_id===f.id||usedIds.has(c.entity_id)),maxKnownAt=Math.max(...used.map(c=>c.known_at)),trainingAllowed=used.every(c=>c.training_allowed===1);
  const fit=await this.trainDependence(f.competition.id),[lambda,mu]=analysis.expectedGoals,rho=Math.min(Math.min(1/(lambda*mu),1)-1e-8,Math.max(Math.max(-1/lambda,-1/mu)+1e-8,fit.rho)),candidate=dixonColes(scoreDistribution(lambda,mu),lambda,mu,rho);
  const versions=[{...analysis,modelVersion:'poisson-temporal-1'},{...analysis,modelVersion:'dc-candidate-1',probabilities:probabilities(candidate),markets:goalMarkets(candidate),btts:goalMarkets(candidate).btts.yes,over25:goalMarkets(candidate).totals.find(r=>r.line===2.5).over,distribution:candidate.sort((a,b)=>b.probability-a.probability).slice(0,16),rho,parameterId:fit.parameterId,parameterCutoff:fit.trainingCutoff,parameterStatus:fit.status,calibrated:false,note:fit.evaluation}];
  for(const payload of versions){const id=await digest([f.id,payload.modelVersion,asOf]);await s.run('INSERT OR IGNORE INTO analysis_forecasts(id,fixture_id,model_version,as_of,kickoff_at,max_known_at,training_allowed,payload,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)',id,f.id,payload.modelVersion,asOf,f.startsAt,maxKnownAt,Number(trainingAllowed),JSON.stringify({...payload,competitionId:f.competition.id,asOf}),JSON.stringify(used.map(c=>c.id)));}
  return{state:'captured',forecasts:versions.length};
 }
 async update({pageSize=50}={}){
  const s=this.store,now=s.now();let batch=await s.one("SELECT * FROM analysis_batches WHERE state='running' ORDER BY updated_at LIMIT 1");
  if(!batch){batch={id:await digest(['analysis-batch',now]),window_start:0,window_end:Math.max(now+8*86400000,(await s.one("SELECT MAX(starts_at) n FROM fixtures WHERE status IN ('NS','TBD','TIMED','SCHEDULED')")).n??0)+1,cursor_time:0,cursor_id:'',state:'running',updated_at:now};await s.upsert('analysis_batches',batch);}
  const rows=await s.all("SELECT id,starts_at,payload FROM fixtures WHERE status IN ('NS','TBD','TIMED','SCHEDULED') AND starts_at<? AND (starts_at>? OR (starts_at=? AND id>?)) ORDER BY starts_at,id LIMIT ?",batch.window_end,batch.cursor_time,batch.cursor_time,batch.cursor_id,pageSize);
  const outcomes={captured:0,cached:0,abstained:0,skipped:0,error:0,exploratory:0};
  for(const row of rows){let result;try{const f=JSON.parse(row.payload);result=await this.capture(f);if(f.kickoffPrecision==='date'){const {savedEstimate}=await import('./estimates.mjs');const {analysisCutoff}=await import('./match-state.mjs');const estimate=await savedEstimate(this.service,f,await this.service.history(f.home.id,f.away.id,analysisCutoff(f,now),f.id));result={state:estimate.probabilities?'exploratory':'abstained',reason:estimate.reason};}}catch(e){result={state:'error',reason:e.message};}
   outcomes[result.state]=(outcomes[result.state]??0)+1;await s.run('INSERT INTO analysis_processing(batch_id,fixture_id,state,payload,attempted_at) VALUES(?,?,?,?,?) ON CONFLICT(batch_id,fixture_id) DO UPDATE SET state=excluded.state,payload=excluded.payload,attempted_at=excluded.attempted_at',batch.id,row.id,result.state,JSON.stringify(result),s.now());
   batch.cursor_time=row.starts_at;batch.cursor_id=row.id;batch.updated_at=s.now();await s.upsert('analysis_batches',batch);
  }
  if(rows.length<pageSize){batch.state='complete';await s.upsert('analysis_batches',batch);}
  return{...outcomes,batchId:batch.id,complete:batch.state==='complete',processed:rows.length,graded:await this.grade(),evaluation:await this.evaluateCandidate()};
 }
 async grade(){let count=0;const s=this.store,rows=await s.all('SELECT p.*,f.payload fixture,f.updated_at result_known_at FROM analysis_forecasts p JOIN fixtures f ON f.id=p.fixture_id');
  for(const row of rows){const f=JSON.parse(row.fixture),lifecycle=matchState(f,s.now());let state='pending',reason='Awaiting a verified regulation-time result',score=null;
   const conflict=await s.one("SELECT c.id FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",row.fixture_id);
   if(conflict){state='withheld';reason='Unresolved provider conflict';}
   else if(f.startsAt!==row.kickoff_at){state='void';reason='Kickoff changed after this forecast; retained outside headline accuracy';}
   else if(lifecycle.state==='cancelled'){state='void';reason='Cancelled or awarded fixture';}
   else if(['postponed','interrupted'].includes(lifecycle.state)){state='withheld';reason=lifecycle.label;}
   else if(lifecycle.state==='completed'){
    score=['FT','FINISHED'].includes(f.status)?{home:f.homeScore,away:f.awayScore}:f.regulationScore;
    if(score&&Number.isInteger(score.home)&&Number.isInteger(score.away)){state='graded';reason='Verified regulation-time result';}else{score=null;state='withheld';reason='Regulation-time score unavailable; extra time and shootouts excluded';}
   }
   const payload={reason,status:f.status,homeScore:score?.home??null,awayScore:score?.away??null,sourceUrl:f.sourceUrl,...(state==='graded'?compareForecast(JSON.parse(row.payload),score.home,score.away):{})};
   const previous=await s.one('SELECT id,state,payload,revision FROM analysis_grade_audit WHERE forecast_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1',row.id);if(previous?.state===state&&previous.payload===JSON.stringify(payload))continue;const revision=await digest([state,payload,previous?.id??null]);
   const auditId=await digest([row.id,revision,s.now()]);await s.run('INSERT OR IGNORE INTO analysis_grade_audit(id,forecast_id,fixture_id,recorded_at,state,revision,payload) VALUES(?,?,?,?,?,?,?)',auditId,row.id,row.fixture_id,s.now(),state,revision,JSON.stringify(payload));
   if(state==='graded'){await s.upsert('analysis_grades',{id:row.id,fixture_id:row.fixture_id,result_known_at:row.result_known_at,outcome:payload.outcome,payload:JSON.stringify(payload)});count++;}else await s.run('DELETE FROM analysis_grades WHERE id=?',row.id);
  }return count;
 }
 async evaluateCandidate(){
  const s=this.store,version='dc-candidate-1',prior=await s.one("SELECT payload FROM model_release_decisions WHERE model_version=? AND state IN ('promoted','rejected') ORDER BY created_at LIMIT 1",version);if(prior)return JSON.parse(prior.payload);
  const rows=await s.all('SELECT p.*,g.outcome,i.canonical_id FROM analysis_forecasts p JOIN analysis_grades g ON g.id=p.id LEFT JOIN fixture_identities i ON i.fixture_id=p.fixture_id ORDER BY p.kickoff_at,p.as_of'),pairs=new Map();
  for(const r of rows){if(r.as_of>=r.kickoff_at||r.max_known_at>r.as_of)continue;const payload=JSON.parse(r.payload);if(r.model_version===version&&!(payload.parameterCutoff<=r.as_of))continue;const key=r.canonical_id??r.fixture_id,item=pairs.get(key)??{};item[r.model_version]={...payload,outcome:r.outcome,id:r.id,kickoff:r.kickoff_at};pairs.set(key,item);}
  const paired=[...pairs.values()].filter(p=>p[version]&&p['poisson-temporal-1']).sort((a,b)=>a[version].kickoff-b[version].kickoff);
  if(paired.length<200)return{state:'collecting',paired:paired.length,required:200,primary:'poisson-temporal-1',reason:'Need 100 chronological validation and 100 later held-out prospective pairs; no improvement established.'};
  const cohort=paired.slice(0,200),measure=list=>({baseline:probabilityMetrics(list.map(p=>p['poisson-temporal-1'])),candidate:probabilityMetrics(list.map(p=>p[version]))}),validation=measure(cohort.slice(0,100)),heldOut=measure(cohort.slice(100)),passes=m=>m.candidate.logLoss<m.baseline.logLoss-.01&&m.candidate.brier<m.baseline.brier;
  const promoted=passes(validation)&&passes(heldOut),result={state:promoted?'promoted':'rejected',version,validation,heldOut,criteria:'Both chronological blocks: log loss improves by >0.01 and Brier improves. One locked evaluation per algorithm version; later tuning requires a new version and untouched later cohort.',forecastIds:cohort.flatMap(p=>[p[version].id,p['poisson-temporal-1'].id])};
  await s.upsert('model_release_decisions',{id:await digest([version,result.forecastIds]),model_version:version,parameter_id:null,created_at:s.now(),state:result.state,payload:JSON.stringify(result)});if(promoted)await s.upsert('model_runtime',{id:'primary',model_version:version,parameter_id:null,updated_at:s.now()});return result;
 }
 async rollback(){await this.store.upsert('model_runtime',{id:'primary',model_version:'poisson-temporal-1',parameter_id:null,updated_at:this.store.now()});await this.store.upsert('model_release_decisions',{id:await digest(['rollback',this.store.now()]),model_version:'poisson-temporal-1',parameter_id:null,created_at:this.store.now(),state:'rollback',payload:JSON.stringify({reason:'Explicit rollback to baseline'})});return{primary:'poisson-temporal-1'};}
 async performance(){const rows=await this.store.all('SELECT p.*,g.payload grade_payload,g.outcome,g.result_known_at,i.canonical_id FROM analysis_forecasts p JOIN analysis_grades g ON g.id=p.id LEFT JOIN fixture_identities i ON i.fixture_id=p.fixture_id ORDER BY p.as_of'),versions=[];
  for(const version of ['poisson-temporal-1','dc-candidate-1']){const unique=new Map();for(const r of rows.filter(r=>r.model_version===version)){if(r.as_of<r.kickoff_at&&r.max_known_at<=r.as_of)unique.set(r.canonical_id??r.fixture_id,r);}const data=[...unique.values()].map(r=>({...JSON.parse(r.payload),outcome:r.outcome,grade:JSON.parse(r.grade_payload),fixtureId:r.fixture_id})),groups={};for(const r of data){(groups[r.competitionId]??=[]).push(r);}const exact=data.filter(r=>r.grade.exactScoreCorrect!=null);versions.push({version,...probabilityMetrics(data),exactScoreCount:exact.length,exactScoreAccuracy:exact.length?exact.filter(r=>r.grade.exactScoreCorrect).length/exact.length:null,byCompetition:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,probabilityMetrics(v)])),uniformBaseline:probabilityMetrics(data.map(r=>({...r,probabilities:[1/3,1/3,1/3]})))});}
  return{versions,period:rows.length?{from:Math.min(...rows.map(r=>r.kickoff_at)),to:Math.max(...rows.map(r=>r.kickoff_at))}:null,forecasts:(await this.store.one('SELECT COUNT(*) n FROM analysis_forecasts')).n,parameters:(await this.store.all('SELECT payload FROM model_parameters')).map(r=>{const {evidenceIds,...summary}=JSON.parse(r.payload);return summary;}),note:'Prospective immutable forecasts only; latest forecast per fixture/version. No reconstructed historical prediction is counted.'};
 }
}
