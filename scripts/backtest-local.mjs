// Read-only chronological reconstruction. This is NOT a prospective accuracy claim.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {originalAnalysis} from '../lib/football/temporal.mjs';
import {elo} from '../lib/football/model.mjs';
import {probabilityMetrics} from '../lib/football/dixon-coles.mjs';
const root='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const file=readdirSync(root).find(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite');if(!file)throw Error('Local database missing');
const db=new DatabaseSync(join(root,file),{readOnly:true});
try{
 const competitions=db.prepare("SELECT id,name FROM competitions WHERE name IN ('Spain Primera División','Italy Serie A','France Ligue 1','Italian Serie A','French Ligue 1')").all(),reports=[];
 for(const competition of competitions){
 const history=db.prepare("SELECT f.payload FROM fixtures f JOIN field_claims c ON c.entity_id=f.id AND c.field='fixture' AND c.training_allowed=1 AND c.valid_to IS NULL WHERE f.competition_id=? AND f.status IN ('FT','FINISHED') AND f.starts_at<? GROUP BY f.id ORDER BY f.starts_at").all(competition.id,Date.now()).map(r=>JSON.parse(r.payload));
 if(history.length<100){reports.push({competition:competition.name,status:'insufficient-history',results:history.length});continue;}
 const testStart=history[Math.floor(history.length*.8)].startsAt,training=history.filter(f=>f.startsAt<testStart),test=history.filter(f=>f.startsAt>=testStart),drawPrior=training.filter(f=>f.homeScore===f.awayScore).length/training.length;
 const baseline=[],eloRows=[],uniform=[];
 for(const fixture of test){const prior=history.filter(f=>f.startsAt<fixture.startsAt);const analysis=originalAnalysis(fixture,prior,{asOf:fixture.startsAt});if(!analysis.probabilities)continue;const outcome=fixture.homeScore>fixture.awayScore?0:fixture.homeScore===fixture.awayScore?1:2;
 baseline.push({probabilities:analysis.probabilities,outcome});const ratings=elo(prior,fixture.startsAt),home=1/(1+10**(((ratings.get(fixture.away.id)??1500)-(ratings.get(fixture.home.id)??1500))/400));eloRows.push({probabilities:[home*(1-drawPrior),drawPrior,(1-home)*(1-drawPrior)],outcome});uniform.push({probabilities:[1/3,1/3,1/3],outcome});}
 reports.push({competition:competition.name,status:'historical-reconstruction',trainingMatches:training.length,testMatches:test.length,eligible:baseline.length,coverage:test.length?baseline.length/test.length:0,period:{from:new Date(testStart).toISOString(),to:new Date(test.at(-1).startsAt).toISOString()},baseline:probabilityMetrics(baseline),elo:probabilityMetrics(eloRows),uniform:probabilityMetrics(uniform)});
 }
 mkdirSync('outputs',{recursive:true});const report={at:new Date().toISOString(),label:'Historical reconstruction — not tracked forecasts',method:'First 80% of dated results precede held-out dates; ties stay in the same partition. Rolling features use only earlier match dates. Draw prior fitted on initial training partition. Data was retrieved later, so historical publication/availability cannot be certified. No model promotion from this report.',reports};writeFileSync('outputs/backtest.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{db.close();}
