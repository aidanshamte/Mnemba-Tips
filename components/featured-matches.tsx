'use client';
import {pickLabel} from '@/lib/football/pick-label.mjs';
import {TeamIdentity,CompetitionIdentity} from './football-identity';
import {useEffect,useRef,useState} from 'react';
import LocalTime from './local-time';
import {competitionLabel} from '@/lib/football/competition-catalog.mjs';
import {featuredFixtures} from '@/lib/football/featured.mjs';
import {useFavouriteLeagues} from './use-favourite-leagues';
type Fixture={phase?:string;savedAt?:number|null;recommendation?:{primary?:{label:string;market?:string;selection?:string;line?:number;probabilities:{win:number}};reasons?:string[];uncertainty?:string;createdAt?:number};id:string;competition:{id?:string;name:string};home:{id:string;name:string;logo?:string};away:{id:string;name:string;logo?:string};startsAt:number;status:string;label:string;homeScore:number|null;awayScore:number|null};
type Overview={note?:string;upcoming?:Fixture[];results?:Fixture[];today?:Fixture[]};
export default function FeaturedMatches({data}:{data:Overview|null}){
 const [currentId,setCurrentId]=useState<string|null>(null),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false),[focused,setFocused]=useState(false);
 const touch=useRef<number|null>(null);
 const {favourites}=useFavouriteLeagues();const fixtures:Fixture[]=featuredFixtures(data?.upcoming??[],favourites);
 // Position is kept by match id, so a background refresh that reorders or extends the list keeps the viewed match.
 const found=currentId?fixtures.findIndex(x=>x.id===currentId):-1,index=found>=0?found:0,f=fixtures[index];
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{if(paused||reduced||focused||fixtures.length<2)return;const t=setInterval(()=>{if(!document.hidden)setCurrentId(fixtures[(index+1)%fixtures.length]?.id??null);},8000);return()=>clearInterval(t);},[paused,reduced,focused,fixtures,index]);
 const next=(direction:number)=>setCurrentId(fixtures[(index+fixtures.length+direction)%Math.max(1,fixtures.length)]?.id??null);
 const live=(data?.today??[]).filter(g=>['1H','2H','HT','ET','LIVE','IN_PLAY'].includes(g.status));
 return <><div className="broadcast-ticker"><strong>{'RECORDED SCORES'}</strong>{(live.length?live:data?.results??[]).slice(0,5).map(g=><a key={g.id} href={`/football/match/${encodeURIComponent(g.id)}`}><TeamIdentity id={g.home.id} name={g.home.name}/> {g.homeScore??'—'} : {g.awayScore??'—'} <TeamIdentity id={g.away.id} name={g.away.name}/></a>)}</div>
 <section className="broadcast-hero" aria-roledescription="carousel" aria-label="Featured matches" onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}} onTouchStart={e=>{touch.current=e.touches[0].clientX;}} onTouchEnd={e=>{if(touch.current!==null&&Math.abs(e.changedTouches[0].clientX-touch.current)>45)next(e.changedTouches[0].clientX<touch.current?1:-1);touch.current=null;}}>
 {/* Local original art avoids remote image tracking and remains available offline. */}
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img className="broadcast-image" src="/football-night-1536.webp" srcSet="/football-night-768.webp 768w, /football-night-1536.webp 1536w" sizes="(max-width:760px) 100vw, 80vw" alt="Original illustration of a football beside a floodlit green pitch" width="1536" height="1024" fetchPriority="high" onError={e=>{e.currentTarget.srcset='';e.currentTarget.src='/football-night.png';}}/>
 <div className="broadcast-copy"><span className="intel-eyebrow">MNEMBA MATCHDAY PICKS · {f?<CompetitionIdentity id={f.competition.id} name={competitionLabel(f.competition)}/>: 'THE WORLD’S GAME'}</span><div aria-live={paused||focused?'polite':'off'}>{f?<><h1><TeamIdentity id={f.home.id} name={f.home.name}/><em>vs <TeamIdentity id={f.away.id} name={f.away.name}/></em></h1><p>{f.phase==='in-play'?'In play · pick published before kickoff':f.phase==='finished'?'Finished · pick published before kickoff':<>{f.label} · <LocalTime fixture={f}/></>}</p><p className="broadcast-insight">{f.recommendation?.primary?<><b>{pickLabel(f.recommendation.primary,f)}</b> · Estimated chance {Math.round(f.recommendation.primary.probabilities.win*100)}%</>:'No qualifying pick yet'}</p></>:<><h1>The game.<em>A little clearer.</em></h1><p>{data?'No qualifying picks yet for this day. Every match is still listed below.':'Opening your football desk…'}</p></>}</div>
 <a className="broadcast-action" href={f?`/football/match/${encodeURIComponent(f.id)}`:'/football/search'}>{f?'Analyze Match ↗':'Explore football ↗'}</a>
 {fixtures.length>1&&<div className="broadcast-controls"><button onClick={()=>next(-1)} aria-label="Previous featured match">←</button><span aria-live="polite">{index+1} / {fixtures.length}</span><button onClick={()=>next(1)} aria-label="Next featured match">→</button><button onClick={()=>setPaused(p=>!p)} disabled={reduced}>{reduced?'Motion reduced':paused?'Play slideshow':'Pause slideshow'}</button></div>}</div><span className="art-credit">Original football artwork · illustrated stadium</span></section></>;
}
