import {goalMarkets} from './markets.mjs';
import {probabilityMetrics} from './dixon-coles.mjs';
import {form,headToHead,elo,historyFor} from './model.mjs';
import {FINAL,SCHEDULED} from './providers.mjs';
import {digest} from './http.mjs';
const HOUR=3600000;
export const HORIZONS={'7d':168*HOUR,'72h':72*HOUR,'24h':24*HOUR,'6h':6*HOUR,'1h':HOUR};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
export function trends(history,teamId,cutoff){
 const games=historyFor(history,teamId,cutoff).slice(-10),scores=games.map(f=>f.home.id===teamId?[f.homeScore,f.awayScore]:[f.awayScore,f.homeScore]);
 return{games:games.length,scored:mean(scores.map(s=>s[0])),conceded:mean(scores.map(s=>s[1])),cleanSheet:mean(scores.map(s=>Number(s[1]===0))),btts:mean(scores.map(s=>Number(s[0]>0&&s[1]>0))),over25:mean(scores.map(s=>Number(s[0]+s[1]>2))),restDays:games.length?(cutoff-games.at(-1).startsAt)/86400000:null,congestion:games.filter(g=>g.startsAt>=cutoff-14*86400000).length};
}
export function scoreDistribution(homeGoals,awayGoals){
 const poisson=(n,x)=>{let p=Math.exp(-x);for(let i=1;i<=n;i++)p*=x/i;return p;};
 const cells=[];let total=0;for(let home=0;home<=10;home++)for(let away=0;away<=10;away++){const probability=poisson(home,homeGoals)*poisson(away,awayGoals);cells.push({home,away,probability});total+=probability;}
 return cells.map(c=>({...c,probability:c.probability/total}));
}
export function originalAnalysis(f,history,context={}){
 const cutoff=context.asOf??f.startsAt,eligible=history.map(g=>['AET','PEN'].includes(g.status)&&g.regulationScore?{...g,status:'FT',homeScore:g.regulationScore.home,awayScore:g.regulationScore.away}:g).filter(g=>!['AET','PEN'].includes(g.status)&&!g.hasConflict&&g.startsAt<Math.min(cutoff,f.startsAt));
 const home=trends(eligible,f.home.id,Math.min(cutoff,f.startsAt)),away=trends(eligible,f.away.id,Math.min(cutoff,f.startsAt));
 const forms=[form(eligible,f.home.id,cutoff),form(eligible,f.away.id,cutoff)],ratings=elo(eligible,cutoff),h2h=headToHead(eligible,f.home.id,f.away.id,cutoff);
 const factors={home,away,homeForm:forms[0],awayForm:forms[1],homeVenue:form(eligible,f.home.id,cutoff,'home'),awayVenue:form(eligible,f.away.id,cutoff,'away'),elo:[ratings.get(f.home.id)??null,ratings.get(f.away.id)??null],headToHead:h2h,injuries:context.injuries??null,lineupProbability:context.lineupProbability??null,tablePosition:context.tablePosition??null,sourceAgreement:context.sourceAgreement??null,freshnessMinutes:context.freshnessMinutes??null,competitionStrength:context.competitionStrength??null};
 if(home.games<3||away.games<3)return{label:'Unavailable',reason:'Three recorded results per team are needed for a supported projection.',factors,missing:['Historical team evidence']};
 const edge=((ratings.get(f.home.id)??1500)-(ratings.get(f.away.id)??1500))/400+(forms[0].score-forms[1].score)*0.35;
 const restEdge=clamp((home.restDays-away.restDays)/30,-0.1,0.1);
 const venue=context.neutralVenue?0:0.12,availability=context.injuries?clamp((context.injuries.away-context.injuries.home)*0.04,-0.2,0.2):0;
 const expected=[clamp((home.scored+away.conceded)/2+edge*0.35+restEdge+venue+availability,0.15,4.5),clamp((away.scored+home.conceded)/2-edge*0.3-restEdge-availability,0.15,4.5)];
 const distribution=scoreDistribution(...expected),probabilities=[0,0,0];for(const c of distribution)probabilities[c.home>c.away?0:c.home===c.away?1:2]+=c.probability;
 const missing=Object.entries(factors).filter(([,v])=>v===null).map(([k])=>k);
 return{markets:goalMarkets(distribution),label:'Mnemba Tips model estimate',modelVersion:'temporal-1',probabilities,expectedGoals:expected,distribution:distribution.sort((a,b)=>b.probability-a.probability).slice(0,16),btts:distribution.filter(c=>c.home&&c.away).reduce((s,c)=>s+c.probability,0),over25:distribution.filter(c=>c.home+c.away>2).reduce((s,c)=>s+c.probability,0),factors,missing,uncertainty:missing.length>3?'High':'Moderate',calibrated:false,explanations:[`Elo difference: ${Math.round((ratings.get(f.home.id)??1500)-(ratings.get(f.away.id)??1500))} points.`,`Recent scoring: ${home.scored.toFixed(2)} vs ${away.scored.toFixed(2)} goals per recorded match.`,`Evidence covers ${home.games} and ${away.games} recent matches; ${missing.length} additional signals are unavailable.`],note:'Independent baseline, not guaranteed outcomes. Calibration requires eligible pre-match observations.'};
}
export function chronologicalSplit(rows){
 const sorted=[...rows].sort((a,b)=>a.kickoffAt-b.kickoffAt);if(sorted.length<10)return{train:[],calibration:[],test:[],reason:'Insufficient independent fixtures'};
 const first=sorted[Math.floor(sorted.length*.6)].kickoffAt,second=sorted[Math.floor(sorted.length*.8)].kickoffAt;
 return{train:sorted.filter(r=>r.kickoffAt<first&&r.resultKnownAt<=first),calibration:sorted.filter(r=>r.kickoffAt>=first&&r.kickoffAt<second&&r.resultKnownAt<=second),test:sorted.filter(r=>r.kickoffAt>=second),trainEnd:first,validationEnd:second,testStart:second};
}
export function calibratedProbabilities(p,temperature){const values=p.map(v=>Math.max(v,1e-9)**(1/temperature)),total=values.reduce((a,b)=>a+b,0);return values.map(v=>v/total);}
export function metrics(rows,temperature=1){return rows.length?probabilityMetrics(rows.map(r=>({...r,probabilities:calibratedProbabilities(r.probabilities,temperature)}))):null;}
export function fitCalibration(rows){
 const unique=[...new Map(rows.map(r=>[r.fixtureId,r])).values()].filter(r=>r.snapshotAt<r.kickoffAt&&r.maxKnownAt<=r.snapshotAt&&r.trainingEligible);
 const split=chronologicalSplit(unique);if(split.calibration.length<5||split.test.length<3)return{status:'insufficient-data',eligible:unique.length,reason:'Need enough leakage-free, training-permitted snapshots across three chronological partitions.'};
 let temperature=1,best=Infinity;for(let t=.65;t<=2.5;t+=.05){const loss=metrics(split.calibration,t).logLoss;if(loss<best){best=loss;temperature=t;}}
 return{status:'fitted',temperature,trainEnd:split.trainEnd,validationEnd:split.validationEnd,testStart:split.testStart,trainCount:split.train.length,calibrationCount:split.calibration.length,testCount:split.test.length,before:metrics(split.test),after:metrics(split.test,temperature),method:'Chronological held-out temperature scaling; fixture-grouped, outcome availability purged'};
}
export class SnapshotEngine {
 constructor(store,evidence){this.store=store;this.evidence=evidence;}
 async capture(f,horizon,targetAt){
  const s=this.store;if(targetAt>s.now()||targetAt>=f.startsAt)return null;
  if(await s.one('SELECT id FROM prematch_snapshots WHERE fixture_id=? AND kickoff_at=? AND horizon=?',f.id,f.startsAt,horizon))return null;
  const current=await this.evidence.asOf(f.id,targetAt),fixtureClaim=current.find(c=>c.field==='fixture');
  let status='captured',payload,evidenceIds=[];
  if(!fixtureClaim||f.kickoffPrecision==='date'){status='missed';payload={reason:!fixtureClaim?'No observation existed at this cutoff; snapshot was not backfilled.':'Kickoff timezone unverified; timed snapshot unavailable.'};}
  else{
   const knownFixture=JSON.parse(fixtureClaim.value_json);
   if(knownFixture.startsAt!==f.startsAt){status='missed';payload={reason:'The current kickoff time was not known at this cutoff.'};}
   else{
    const rows=await s.all("SELECT c.* FROM field_claims c WHERE c.entity_kind='fixture' AND c.field='fixture' AND c.known_at<=? AND (c.published_at IS NULL OR c.published_at<=?) AND (c.valid_to IS NULL OR c.valid_to>?) AND c.expires_at>?",targetAt,targetAt,targetAt,targetAt);
    const history=rows.map(r=>JSON.parse(r.value_json)).filter(g=>FINAL.has(g.status)&&g.startsAt<targetAt);
    const details=Object.fromEntries(current.filter(c=>['injuries','lineups','standings'].includes(c.field)).map(c=>[c.field,JSON.parse(c.value_json)]));
    const news=await s.all("SELECT id,source_url,published_at,known_at,source_id FROM field_claims WHERE entity_id=? AND field='news' AND known_at<=? AND (published_at IS NULL OR published_at<=?)",f.id,targetAt,targetAt);
    const analysis=originalAnalysis(knownFixture,history,{asOf:targetAt,tablePosition:details.standings??null,lineupProbability:details.lineups??null});
    evidenceIds=[...new Set([...current,...rows].map(c=>c.id))];
    payload={schemaVersion:'temporal-1',analysis,newsEvidence:news,availabilityEvidence:current.filter(c=>['injuries','lineups','standings'].includes(c.field)).map(c=>c.id),trainingEligible:[...current,...rows].every(c=>c.training_allowed===1),maxKnownAt:Math.max(...[...current,...rows].map(c=>c.known_at)),note:'Only evidence observed by asOf is included. No article/social full text is retained in snapshots.'};
   }
  }
  const id=await digest([f.id,f.startsAt,horizon]);await s.run('INSERT OR IGNORE INTO prematch_snapshots(id,fixture_id,kickoff_at,horizon,target_at,captured_at,as_of,status,evidence_ids,payload) VALUES(?,?,?,?,?,?,?,?,?,?)',id,f.id,f.startsAt,horizon,targetAt,s.now(),targetAt,status,JSON.stringify(evidenceIds),JSON.stringify(payload));return{id,status};
 }
 async due(){const rows=await this.store.all('SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? ORDER BY starts_at LIMIT 300',this.store.now(),this.store.now()+8*86400000);let count=0;for(const row of rows){const f=JSON.parse(row.payload);if(!SCHEDULED.has(f.status))continue;for(const [horizon,offset] of Object.entries(HORIZONS))if(await this.capture(f,horizon,f.startsAt-offset))count++;}return{snapshots:count};}
 async calibration(){
  const rows=await this.store.all("SELECT s.*,f.payload AS fixture,f.updated_at AS result_known_at FROM prematch_snapshots s JOIN fixtures f ON f.id=s.fixture_id WHERE s.status='captured' AND f.status IN ('FT','AET','PEN','FINISHED') ORDER BY s.as_of");
  const data=rows.flatMap(r=>{const p=JSON.parse(r.payload),f=JSON.parse(r.fixture);return p.analysis?.probabilities&&f.homeScore!==null&&f.awayScore!==null?[{fixtureId:r.fixture_id,kickoffAt:r.kickoff_at,snapshotAt:r.as_of,maxKnownAt:p.maxKnownAt,trainingEligible:p.trainingEligible,resultKnownAt:r.result_known_at,probabilities:p.analysis.probabilities,outcome:f.homeScore>f.awayScore?0:f.homeScore===f.awayScore?1:2}]:[];});
  const result=fitCalibration(data);if(result.status==='fitted')await this.store.upsert('calibration_models',{id:crypto.randomUUID(),version:'temperature-1',trained_at:this.store.now(),train_end:result.trainEnd,validation_end:result.validationEnd,test_start:result.testStart,temperature:result.temperature,payload:JSON.stringify(result)});
  await this.store.putCache('calibration-status',result,86400000);return result;
 }
}
