import {archiveFor} from './forecast-history.mjs';
import {ModelLab} from './model-lab.mjs';
import {matchState,analysisCutoff} from './match-state.mjs';
import {originalAnalysis} from './temporal.mjs';
import {digest} from './http.mjs';
// An exploratory estimate is archived separately from graded forecasts. In
// particular, a date-only schedule never supplies an invented kickoff instant.
export async function savedEstimate(service,fixture,history){
 const s=service.store,asOf=s.now();
 const state=matchState(fixture,asOf);if(state.forecastEligible&&!s.readOnly)await new ModelLab(service).capture(fixture);
 const archive=await archiveFor(service,fixture);if(archive.selected)return{...archive.selected.payload,archive,estimateKind:'tracked',statusNotice:state.notice,trackingNote:'Immutable forecast saved before verified kickoff. Regulation time only.'};
 if(!state.previewAllowed)return{...originalAnalysis(fixture,history,{asOf:analysisCutoff(fixture,asOf)}),probabilities:undefined,distribution:undefined,markets:undefined,archive,...{label:state.state==='completed'?'Historical analysis':state.label,reason:state.state==='completed'?'No genuine earlier forecast is available; the recorded result is not claimed as a prediction.':state.notice??'A new pre-match estimate is unavailable in this match state.'}};
 const conflicts=await s.one("SELECT c.id FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",fixture.id);
 if(conflicts)return{label:'Awaiting verification',reason:'Fixture sources disagree. The estimate is withheld until verified.'};
 const revision=await digest([fixture,history.map(f=>[f.id,f.startsAt,f.homeScore,f.awayScore,f.hasConflict])]);
 const cached=await s.one('SELECT payload,as_of FROM exploratory_estimates WHERE fixture_id=? AND revision=? AND as_of>? ORDER BY as_of DESC LIMIT 1',fixture.id,revision,s.readOnly?0:asOf-1800000);
 if(cached)return {...JSON.parse(cached.payload),archive};
 if(s.readOnly)return{label:'Awaiting scheduled analysis',reason:'No saved estimate matches the current evidence. Scheduled updates will create eligible forecasts.',archive};
 const analysis=originalAnalysis(fixture,history,{asOf:analysisCutoff(fixture,asOf)});if(!analysis.probabilities)return analysis;
 const result={...analysis,asOf,statusNotice:state.notice,estimateKind:'exploratory',kickoffPrecision:fixture.kickoffPrecision??'instant',trackingNote:'Saved exploratory estimate; excluded from measured forecast accuracy. A verified kickoff and eligible evidence are required for tracked forecasting.'};
 const id=await digest([fixture.id,revision,asOf]);
 await s.run('INSERT INTO exploratory_estimates(id,fixture_id,as_of,revision,payload) VALUES(?,?,?,?,?)',id,fixture.id,asOf,revision,JSON.stringify(result));
 return {...result,archive};
}
