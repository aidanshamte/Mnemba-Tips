'use client';
import {useState} from 'react';
import {TeamIdentity} from './football-identity';
import LocalTime from './local-time';
import {pickLabel} from '@/lib/football/pick-label.mjs';
type Side={id:string;name:string};
type Option={market:string;selection?:string;line?:number;probabilities:{win:number}};
export type DailyPick={phase?:string;savedAt?:number|null;fixture:{id:string;startsAt:number;kickoffPrecision?:string;status?:string;homeScore?:number|null;awayScore?:number|null;home:Side;away:Side};recommendation?:{primary?:Option|null;uncertainty?:string}};
const PAGE=20;
/** Every qualifying pick for the selected day, compact. Paged for speed; the total and a way to reach all are always shown. */
export default function DailyPicks({picks}:{picks:DailyPick[]}){
 const [shown,setShown]=useState(PAGE);
 if(!picks.length)return <section className="intel-panel daily-picks" aria-labelledby="daily-picks-title"><h2 id="daily-picks-title" className="mt-card-heading">All picks for this day</h2><p className="pick-none">No qualifying picks yet.</p></section>;
 const visible=picks.slice(0,shown),left=picks.length-visible.length;
 return <section className="intel-panel daily-picks" aria-labelledby="daily-picks-title">
  <h2 id="daily-picks-title" className="mt-card-heading">All picks for this day <span className="daily-picks-count">{picks.length}</span></h2>
  <ol className="daily-picks-list">{visible.map(({fixture:f,recommendation:r,phase,savedAt})=>{const p=r?.primary;return <li key={f.id}><a className="daily-pick" href={`/football/match/${encodeURIComponent(f.id)}`}>
   <span className="daily-pick-teams"><span><TeamIdentity id={f.home.id} name={f.home.name} variant="tiny"/></span><span><TeamIdentity id={f.away.id} name={f.away.name} variant="tiny"/></span></span>
   <span className="daily-pick-when">{phase==='in-play'?<b className="daily-pick-live">In play{f.homeScore!=null?` ${f.homeScore}–${f.awayScore}`:''}</b>:phase==='finished'?<>Finished{f.homeScore!=null?` ${f.homeScore}–${f.awayScore}`:''}</>:<LocalTime fixture={f}/>}</span>
   {p&&<span className="daily-pick-market"><span>{pickLabel(p,f)}</span><strong>{Math.round(p.probabilities.win*100)}%</strong></span>}
   <span className="daily-pick-meta">{phase&&phase!=='upcoming'?'Published before kickoff':savedAt?<>Saved <LocalTime fixture={{startsAt:savedAt}}/></>:'Provisional estimate'}</span>
  </a></li>;})}</ol>
  {left>0&&<button type="button" className="mt-btn mt-btn-quiet daily-picks-more" onClick={()=>setShown(n=>n+PAGE)}>Show {Math.min(PAGE,left)} more · {left} not shown yet</button>}
 </section>;
}
