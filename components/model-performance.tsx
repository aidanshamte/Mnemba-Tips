'use client';
import {useEffect,useState} from 'react';
type Performance={forecasts:number;versions:{version:string;count:number;accuracy:number;brier:number;logLoss:number}[];period?:{from:number;to:number}|null};
export default function ModelPerformance(){
 const [data,setData]=useState<Performance|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void fetch('/api/intelligence?view=performance',{signal:c.signal}).then(r=>{if(!r.ok)throw Error('Prediction tracking is temporarily unavailable.');return r.json() as Promise<Performance>;}).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[]);
 const baseline=data?.versions.find(v=>v.version==='poisson-temporal-1');
 return <section className="tracking-card" aria-label="Prediction tracking"><div><span className="intel-eyebrow">THE RECORD MATTERS</span><h2>{baseline?.count?'Prediction tracking':'Prediction tracking is starting.'}</h2><p>{error||`Completed predictions: ${baseline?.count??'—'}.`}</p></div><div><strong>{baseline?.count?`Accuracy: ${(baseline.accuracy*100).toFixed(1)}%`:'Accuracy: Not enough results yet.'}</strong><p>Estimates today. Measured results as matches finish.</p>{!!baseline?.count&&<details><summary>How we measure</summary><p>Latest saved baseline forecast per match, recorded before kickoff. Brier {baseline.brier.toFixed(3)} · Log loss {baseline.logLoss.toFixed(3)}. Lower is better.</p>{data?.period&&<p>{new Date(data.period.from).toLocaleDateString()} – {new Date(data.period.to).toLocaleDateString()}</p>}</details>}</div></section>;
}
