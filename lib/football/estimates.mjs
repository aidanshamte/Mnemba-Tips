import {archiveFor} from './forecast-history.mjs';
import {ModelLab} from './model-lab.mjs';
import {matchState,analysisCutoff} from './match-state.mjs';
import {originalAnalysis} from './temporal.mjs';
import {digest} from './digest.mjs';
// Presentation fields (labels, logos, lifecycle and source-claim wrappers) differ
// between background jobs and public reads. Hash only model input evidence.
export function estimateRevision(f,history){
 const evidence=g=>[g.id,g.competition?.id,g.seasonId,g.home?.id,g.away?.id,g.startsAt,g.kickoffPrecision??'instant',g.status,g.homeScore??null,g.awayScore??null,!!g.hasConflict];
 return digest([evidence(f),history.map(evidence).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
// An exploratory estimate is archived separately from graded forecasts. In
// particular, a date-only schedule never supplies an invented kickoff instant.
export async function savedEstimate(service,fixture,history){
 const s=service.store,asOf=s.now();
 const state=matchState(fixture,asOf);if(state.forecastEligible&&!s.readOnly)await new ModelLab(service).capture(fixture);
 const archive=await archiveFor(service,fixture);if(archive.selected){const current=archive.selected.eligible&&archive.selected.kickoffAt===fixture.startsAt&&!['void','withheld'].includes(archive.selected.gradeState);return{...archive.selected.payload,archive,estimateKind:'tracked',needsRefresh:!current&&state.previewAllowed,historical:!current||!state.previewAllowed,statusNotice:current?state.notice:'Saved forecast for an earlier schedule or evidence state; retained as history.',trackingNote:'Immutable forecast saved before verified kickoff. Regulation time only.'};}
 const latest=archive.exploratory.find(e=>Array.isArray(e.payload.probabilities)&&e.payload.probabilities.length===3&&e.payload.probabilities.every(p=>Number.isFinite(p)&&p>=0&&p<=1)&&Math.abs(e.payload.probabilities.reduce((n,p)=>n+p,0)-1)<.001);
 const savedPreview=(needsRefresh,historical=false)=>({...latest.payload,asOf:latest.createdAt,archive,estimateKind:'exploratory',needsRefresh,historical,statusNotice:historical?'Saved exploratory preview. Excluded from tracked accuracy.':needsRefresh?'Needs refresh · saved preview from earlier evidence. Scheduled analysis will check for a replacement.':state.notice,trackingNote:'Saved exploratory preview; excluded from tracked accuracy.'});
 if(!state.previewAllowed&&latest)return savedPreview(false,true);
 if(!state.previewAllowed)return{...originalAnalysis(fixture,history,{asOf:analysisCutoff(fixture,asOf)}),probabilities:undefined,distribution:undefined,markets:undefined,archive,...{label:state.state==='completed'?'Historical analysis':state.label,reason:state.state==='completed'?'No genuine earlier forecast is available; the recorded result is not claimed as a prediction.':state.notice??'A new pre-match estimate is unavailable in this match state.'}};
 const conflicts=await s.one("SELECT c.id FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",fixture.id);
 if(conflicts)return latest?{...savedPreview(true,true),statusNotice:'Sources disagree. This earlier preview is historical, pending verification.'}:{label:'Awaiting verification',reason:'Fixture sources disagree. The estimate is withheld until verified.',archive};
 const revision=await estimateRevision(fixture,history);
 const cached=await s.one('SELECT payload,as_of FROM exploratory_estimates WHERE fixture_id=? AND revision=? AND as_of>? ORDER BY as_of DESC LIMIT 1',fixture.id,revision,s.readOnly?0:asOf-1800000);
 if(cached)return {...JSON.parse(cached.payload),asOf:cached.as_of,archive,needsRefresh:state.needsRefresh,statusNotice:state.notice};
 if(s.readOnly)return latest?savedPreview(true):{label:'Awaiting scheduled analysis',reason:'A saved prediction is not available yet. Scheduled analysis will check the earlier results.',archive};
 const analysis=originalAnalysis(fixture,history,{asOf:analysisCutoff(fixture,asOf)});if(!analysis.probabilities)return analysis;
 const result={...analysis,asOf,statusNotice:state.notice,estimateKind:'exploratory',kickoffPrecision:fixture.kickoffPrecision??'instant',trackingNote:'Saved exploratory estimate; excluded from measured forecast accuracy. A verified kickoff and eligible evidence are required for tracked forecasting.'};
 const id=await digest([fixture.id,revision,asOf]);
 await s.run('INSERT INTO exploratory_estimates(id,fixture_id,as_of,revision,payload) VALUES(?,?,?,?,?)',id,fixture.id,asOf,revision,JSON.stringify(result));
 return {...result,archive};
}
