'use client';
import {createContext,useContext,useRef,useState,useSyncExternalStore} from 'react';
import {formatKickoff,validZone} from '@/lib/football/timezone.mjs';
const TimeContext=createContext<{zone:string|null;preference:string;choose:(value:string)=>void}>({zone:null,preference:'local',choose:()=>{}});
let memoryPreference='local';
function subscribe(listener:()=>void){window.addEventListener('storage',listener);window.addEventListener('mnemba-timezone',listener);return()=>{window.removeEventListener('storage',listener);window.removeEventListener('mnemba-timezone',listener);};}
function snapshot(){let preference=memoryPreference;try{preference=localStorage.getItem('mnemba-timezone')??preference;}catch{}if(preference!=='local'&&!validZone(preference))preference='local';return preference+'\n'+Intl.DateTimeFormat().resolvedOptions().timeZone;}
const serverSnapshot=()=>'';
export function TimeProvider({children}:{children:React.ReactNode}) {
 const value=useSyncExternalStore(subscribe,snapshot,serverSnapshot),[preference='local',detected]=value?value.split('\n'):['local'];
 const choose=(next:string)=>{memoryPreference=next;try{localStorage.setItem('mnemba-timezone',next);}catch{}window.dispatchEvent(new Event('mnemba-timezone'));};
 return <TimeContext.Provider value={{zone:preference==='local'?detected??null:preference,preference,choose}}>{children}</TimeContext.Provider>;
}
export const useTimeZone=()=>useContext(TimeContext);
export function TimePreference(){
 const {zone,preference,choose}=useTimeZone(),dialog=useRef<HTMLDialogElement>(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const common=['UTC','Africa/Dar_es_Salaam','America/New_York','Europe/London'];
 const zones=open&&typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
 const matches=zones.filter(z=>z.replaceAll('_',' ').toLowerCase().includes(query.trim().replaceAll('_',' ').toLowerCase()));
 const regions=[...new Set(matches.map(z=>z.split('/')[0]))];
 function close(){dialog.current?.close();setOpen(false);}
 return <div className="timezone-picker"><label>Times shown in <select aria-label="Timezone" value={preference} onChange={e=>choose(e.target.value)}><option value="local">Automatic{zone&&preference==='local'?` — ${zone}`:' — local time'}</option>{[...new Set([...common,...(preference==='local'?[]:[preference])])].map(z=><option key={z}>{z}</option>)}</select></label>
 <button type="button" aria-haspopup="dialog" onClick={()=>{setQuery('');setOpen(true);dialog.current?.showModal();}}>More timezones</button>
 <dialog ref={dialog} className="competition-dialog" aria-labelledby="timezone-title" onClose={()=>setOpen(false)} onClick={e=>{if(e.target===dialog.current)close();}}>
 {open&&<><div className="competition-dialog-head"><h2 id="timezone-title">Choose a timezone</h2><button type="button" onClick={close} aria-label="Close timezone picker">✕</button></div>
 <input autoFocus aria-label="Search timezones" placeholder="Search city or region" value={query} onChange={e=>setQuery(e.target.value)}/>
 <div className="competition-options">{regions.map(region=><section key={region}><h3>{region}</h3>{matches.filter(z=>z.split('/')[0]===region).map(z=><button type="button" key={z} aria-pressed={preference===z} onClick={()=>{choose(z);close();}}>{z.replaceAll('_',' ')}</button>)}</section>)}{!matches.length&&<p>No matching timezones.</p>}</div></>}
 </dialog></div>;
}
export default function LocalTime({fixture}:{fixture:{startsAt:number;kickoffPrecision?:string}}){const {zone}=useTimeZone();return <time dateTime={fixture.kickoffPrecision==='date'?undefined:new Date(fixture.startsAt).toISOString()}>{formatKickoff(fixture,zone)}</time>;}
