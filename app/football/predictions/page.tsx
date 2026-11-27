'use client';
import {useEffect,useState} from 'react';
import PublicNav from '@/components/public-nav';
import {Skeleton} from '@/components/mt-ui';
import ResultRow,{type HistoryMatch} from '@/components/result-row';
import {useTimeZone} from '@/components/local-time';
type Learning={primary:string;lastSuccess:number|null;nextEvaluation:number|null;period:{from:number;to:number}|null;challenger:{state:string;reason?:string}|null;versions:{version:string;count:number;accuracy:number|null;brier:number|null}[]};
type History={learning?:Learning;matches:HistoryMatch[];nextOffset:number|null;note:string};
const tabs=[['today','Today'],['yesterday','Yesterday'],['week','Last 7 days'],['pending','Pending'],['completed','Completed'],['exploratory','Exploratory previews'],['all','All']];
export default function PredictionsPage(){
 const {zone}=useTimeZone();
 const [data,setData]=useState<History|null>(null),[offset,setOffset]=useState(0),[tab,setTab]=useState('today'),[error,setError]=useState('');
 useEffect(()=>{if(!zone)return;const controller=new AbortController();setData(null);setError('');void fetch(`/api/intelligence?${new URLSearchParams({view:'prediction-history',offset:String(offset),tab,timezone:zone})}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Prediction history is temporarily unavailable.');return r.json();}).then(value=>setData(value as History)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[offset,tab,zone]);
 return <div className="intel"><main className="match-center"><PublicNav/><h1>Results</h1><a href="/football/shortlists">Published matchday shortlists →</a>
 <nav className="history-filters" aria-label="Prediction history filters" style={{display:'flex',flexWrap:'wrap',gap:8,margin:'20px 0'}}>{tabs.map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);setOffset(0);}}>{label}</button>)}</nav>
 {error&&<p role="alert">{error}</p>}{!data&&!error&&<Skeleton lines={4} label="Loading saved predictions"/>}
 {data?.matches.length===0&&<section className="intel-panel"><h2>No saved records in this view</h2><p>Tracked forecasts require verified kickoff times and sufficient earlier evidence. Exploratory previews remain accessible in their own tab and are excluded from accuracy.</p><a href="/football">Explore matches →</a></section>}
 <div className="result-list">{data?.matches.map(m=><ResultRow key={m.fixture.id} m={m}/>)}</div>
 {data?.learning&&<section className="intel-panel"><h2>Mnemba Learning Record</h2><p>Production model: {data.learning.primary}</p>{data.learning.versions.filter(v=>v.version===data.learning?.primary).map(v=><div key={v.version}><p>Completed graded matches: {v.count} · Result-pick accuracy: {v.accuracy===null?'Insufficient sample':`${(v.accuracy*100).toFixed(1)}%`}</p><p>Brier score: {v.brier===null?'Not available':v.brier.toFixed(3)}. Lower scores mean estimated probabilities were closer to the observed outcomes.</p><p>Calibration: {v.count<200?'Insufficient prospective sample to establish reliability.':'Under evaluation; a measured score does not guarantee future performance.'}</p></div>)}<p>Challenger: {data.learning.challenger?.state??'Awaiting eligible observations'}. {data.learning.challenger?.reason}</p><p>Evaluation period: {data.learning.period?`${new Date(data.learning.period.from).toLocaleDateString()} – ${new Date(data.learning.period.to).toLocaleDateString()}`:'No eligible graded matches'}</p><p>Last successful model job: {data.learning.lastSuccess?new Date(data.learning.lastSuccess).toLocaleString():'Not recorded'} · Next evaluation due: {data.learning.nextEvaluation?new Date(data.learning.nextEvaluation).toLocaleString():'Not recorded'} (subject to scheduler and data availability).</p></section>}
 <p>{data?.note}</p>{offset>0&&<button type="button" className="mt-pager" onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button>}{data?.nextOffset!=null&&<button type="button" className="mt-pager" onClick={()=>setOffset(data.nextOffset??offset)}>Next</button>}
 <p>Predictions are probabilistic, never guaranteed. Play responsibly and never risk money needed for essentials.</p></main></div>;
}
