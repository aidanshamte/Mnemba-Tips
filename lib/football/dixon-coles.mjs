import {topPick} from './forecast-history.mjs';
// Low-score correction: Dixon & Coles (1997), as restated in arXiv:2307.02139 §2.1.
export function tau(home,away,lambda,mu,rho){return home===0&&away===0?1-lambda*mu*rho:home===0&&away===1?1+lambda*rho:home===1&&away===0?1+mu*rho:home===1&&away===1?1-rho:1;}
export function dixonColes(cells,lambda,mu,rho=0){
 if(!Number.isFinite(lambda)||!Number.isFinite(mu)||lambda<=0||mu<=0)throw Error('Positive expected goals required');
 const lower=Math.max(-1/lambda,-1/mu),upper=Math.min(1/(lambda*mu),1);if(!Number.isFinite(rho)||rho<lower||rho>upper)throw Error('Dixon–Coles parameter outside nonnegative probability bounds');
 const adjusted=cells.map(c=>({...c,probability:c.probability*tau(c.home,c.away,lambda,mu,rho)})),total=adjusted.reduce((n,c)=>n+c.probability,0);return adjusted.map(c=>({...c,probability:c.probability/total}));
}
export function fitRho(rows,asOf){
 // Parameter training uses only training-permitted, already observed completed records.
 const eligible=rows.filter(r=>r.trainingAllowed===true&&r.knownAt<=asOf&&r.playedAt<asOf&&Number.isFinite(r.lambda)&&Number.isFinite(r.mu)&&r.lambda>0&&r.mu>0);
 if(eligible.length<50)return{rho:0,status:'insufficient-data',count:eligible.length};
 let rho=0,best=-Infinity;for(let step=-20;step<=20;step++){const candidate=step/100;let likelihood=0,valid=true;for(const r of eligible){const factors=[tau(0,0,r.lambda,r.mu,candidate),tau(0,1,r.lambda,r.mu,candidate),tau(1,0,r.lambda,r.mu,candidate),tau(1,1,r.lambda,r.mu,candidate)];if(factors.some(v=>v<=0)){valid=false;break;}const weight=Math.exp(-(asOf-r.playedAt)/(365*86400000));likelihood+=weight*Math.log(tau(r.homeScore,r.awayScore,r.lambda,r.mu,candidate));}if(valid&&likelihood>best){best=likelihood;rho=candidate;}}
 return{rho,status:'trained-candidate',count:eligible.length,asOf,method:'Recency-weighted low-score likelihood; candidate only until prospective validation',maxKnownAt:Math.max(...eligible.map(r=>r.knownAt))};
}
export function probabilityMetrics(rows){
 if(!rows.length)return{count:0,accuracy:null,brier:null,logLoss:null,rankedProbabilityScore:null,calibration:[],classes:[],reason:'No eligible graded forecasts yet.'};
 let tied=0,correct=0,brier=0,logLoss=0,rps=0;const bins=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,count:0,predicted:0,observed:0})),classes=Array.from({length:3},(_,i)=>({outcome:i,tp:0,fp:0,fn:0}));
 for(const r of rows){const p=r.probabilities;if(p.length!==3||p.some(v=>!Number.isFinite(v)||v<0)||Math.abs(p.reduce((n,v)=>n+v,0)-1)>1e-6||![0,1,2].includes(r.outcome))throw Error('Invalid probability evaluation row');const selected=topPick(p);tied+=Number(selected===null);correct+=Number(selected===r.outcome);brier+=p.reduce((n,v,i)=>n+(v-Number(r.outcome===i))**2,0);logLoss-=Math.log(Math.max(p[r.outcome],1e-12));let cumulative=0;for(let i=0;i<2;i++){cumulative+=p[i];rps+=(cumulative-Number(r.outcome<=i))**2/2;}for(let i=0;i<3;i++){const b=bins[Math.min(9,Math.floor(p[i]*10))];b.count++;b.predicted+=p[i];b.observed+=Number(r.outcome===i);classes[i].tp+=Number(selected===i&&r.outcome===i);classes[i].fp+=Number(selected===i&&r.outcome!==i);classes[i].fn+=Number(selected!==i&&r.outcome===i);}}
 return{count:rows.length,accuracy:rows.length>tied?correct/(rows.length-tied):null,tiedPicks:tied,decisivePicks:rows.length-tied,brier:brier/rows.length,logLoss:logLoss/rows.length,rankedProbabilityScore:rps/rows.length,calibration:bins.filter(b=>b.count).map(b=>({...b,predicted:b.predicted/b.count,observed:b.observed/b.count})),classes:classes.map(c=>({...c,precision:c.tp+c.fp?c.tp/(c.tp+c.fp):null,recall:c.tp+c.fn?c.tp/(c.tp+c.fn):null}))};
}
