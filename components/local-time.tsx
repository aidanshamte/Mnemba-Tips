'use client';
import {createContext,useContext,useSyncExternalStore} from 'react';
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
export function TimePreference(){const {zone,preference,choose}=useTimeZone();const zones=zone?(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['Africa/Dar_es_Salaam','America/New_York','Europe/London']):[];return <label className="timezone-picker">Times shown in <select aria-label="Timezone" value={preference} onChange={e=>choose(e.target.value)}><option value="local">Your local time{zone&&preference==='local'?` (${zone})`:''}</option>{[...new Set(['UTC',...zones,...(preference==='local'?[]:[preference])])].map(z=><option key={z}>{z}</option>)}</select></label>;}
export default function LocalTime({fixture}:{fixture:{startsAt:number;kickoffPrecision?:string}}){const {zone}=useTimeZone();return <time dateTime={fixture.kickoffPrecision==='date'?undefined:new Date(fixture.startsAt).toISOString()}>{formatKickoff(fixture,zone)}</time>;}
