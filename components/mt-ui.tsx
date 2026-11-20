// Mnemba Tips shared status primitives (Figma: Data provenance tag, Match status,
// Prediction grade, State panel, Inline banner, Loading skeleton, Uncertainty indicator).
// Server-safe: no hooks. Status is always icon + word, never colour alone.
import type {ReactNode} from 'react';
import {LIVE_STALE_MS} from '@/lib/football/match-state.mjs';
import {ShieldCheck,Sparkles,ChartColumn,Info,Clock,TriangleAlert,Pause,Check,X,Calendar,WifiOff,History,CircleCheck,CircleX} from 'lucide-react';

export type SourceKind='confirmed'|'estimate'|'exploratory'|'unavailable';
const SOURCE:Record<SourceKind,{label:string;Icon:typeof Info}>={
 confirmed:{label:'Confirmed by source',Icon:ShieldCheck},
 estimate:{label:'Model estimate',Icon:Sparkles},
 exploratory:{label:'Exploratory analysis',Icon:ChartColumn},
 unavailable:{label:'Not available yet',Icon:Info},
};
export function SourceTag({kind,label}:{kind:SourceKind;label?:string}){const {Icon,label:fallback}=SOURCE[kind];return <span className={`mt-tag mt-source-${kind}`}><Icon aria-hidden="true" size={14}/>{label??fallback}</span>;}

export type MatchStatusKind='scheduled'|'unconfirmed'|'live'|'halftime'|'overdue'|'finished'|'postponed'|'abandoned';
const STATUS:Record<MatchStatusKind,{label:string;Icon:typeof Info|null}>={
 scheduled:{label:'Scheduled',Icon:Clock},unconfirmed:{label:'Time not confirmed',Icon:TriangleAlert},live:{label:'Live',Icon:null},
 halftime:{label:'Half-time',Icon:Pause},overdue:{label:'Result not confirmed',Icon:TriangleAlert},finished:{label:'Full time',Icon:Check},postponed:{label:'Postponed',Icon:Calendar},abandoned:{label:'Abandoned',Icon:X},
};
/** Map provider status codes onto the design vocabulary. Unknown codes stay scheduled. */
export function matchStatusKind(status?:string,kickoffPrecision?:string,startsAt?:number,now:number=Date.now()):MatchStatusKind{
 const s=(status??'').toUpperCase();
 const inPlay=['1H','2H','ET','P','LIVE','IN_PLAY','BT','HT','PAUSED'].includes(s);
 // Stale live statuses are never presented as live (same threshold as lib/football/match-state.mjs).
 if(inPlay&&Number.isFinite(startsAt)&&now-(startsAt as number)>LIVE_STALE_MS)return 'overdue';
 if(['1H','2H','ET','P','LIVE','IN_PLAY','BT'].includes(s))return 'live';
 if(s==='HT'||s==='PAUSED')return 'halftime';
 if(['FT','AET','PEN','FINISHED','AWARDED'].includes(s))return 'finished';
 if(['PST','POSTPONED','SUSP','SUSPENDED'].includes(s))return 'postponed';
 if(['ABD','CANC','CANCELLED','ABANDONED'].includes(s))return 'abandoned';
 if(kickoffPrecision==='date'||s==='TBD')return 'unconfirmed';
 return 'scheduled';
}
export function StatusTag({kind,label}:{kind:MatchStatusKind;label?:string}){const {Icon,label:fallback}=STATUS[kind];return <span className={`mt-tag mt-status-${kind}`}>{Icon?<Icon aria-hidden="true" size={14}/>:<span className="mt-live-dot" aria-hidden="true"/>}{label??fallback}</span>;}

export type GradeKind='correct'|'incorrect'|'pending'|'void'|'exploratory';
const GRADE:Record<GradeKind,{label:string;Icon:typeof Info}>={correct:{label:'Correct',Icon:CircleCheck},incorrect:{label:'Incorrect',Icon:CircleX},pending:{label:'Pending result',Icon:Clock},void:{label:'Void',Icon:Info},exploratory:{label:'Exploratory · not graded',Icon:ChartColumn}};
export function GradeBadge({kind,label}:{kind:GradeKind;label?:string}){const {Icon,label:fallback}=GRADE[kind];return <span className={`mt-tag mt-grade-${kind}`}><Icon aria-hidden="true" size={14}/>{label??fallback}</span>;}

export type StateKind='empty'|'missing'|'error'|'offline'|'tracking'|'loading';
const STATE_ICON:Record<StateKind,typeof Info>={empty:Calendar,missing:Info,error:TriangleAlert,offline:WifiOff,tracking:History,loading:Clock};
/** Full-section state: title says what happened, body says why and what to do, one optional action. */
export function StatePanel({kind,title,children,action}:{kind:StateKind;title:string;children?:ReactNode;action?:ReactNode}){
 const Icon=STATE_ICON[kind];
 return <section className={`mt-state mt-state-${kind}`} role={kind==='error'?'alert':'status'} aria-busy={kind==='loading'||undefined}><span className="mt-state-icon" aria-hidden="true"><Icon size={26} strokeWidth={1.75}/></span><h2 className="mt-card-title">{title}</h2>{children&&<div className="mt-supporting">{children}</div>}{action}</section>;
}
/** Inline banner above affected content (stale, missing, offline, error). */
export function Notice({kind,children}:{kind:'stale'|'missing'|'offline'|'error';children:ReactNode}){
 const Icon={stale:Clock,missing:Info,offline:WifiOff,error:TriangleAlert}[kind];
 return <p className={`mt-notice mt-notice-${kind}`} role={kind==='error'?'alert':'status'}><Icon aria-hidden="true" size={18}/><span>{children}</span></p>;
}
export function Skeleton({lines=3,label='Loading'}:{lines?:number;label?:string}){return <div className="mt-skeleton" aria-busy="true"><span className="mt-visually-hidden">{label}</span>{Array.from({length:lines},(_,i)=><span key={i} className="mt-skeleton-line" style={{width:`${92-i*14}%`}}/>)}</div>;}

export type UncertaintyLevel='lower'|'moderate'|'higher'|'unknown';
export function Uncertainty({level}:{level:UncertaintyLevel}){const bars={lower:1,moderate:2,higher:3,unknown:0}[level];return <span className={`mt-uncertainty mt-uncertainty-${level}`}><span className="mt-meter" aria-hidden="true">{[1,2,3].map(i=><i key={i} className={i<=bars?'on':''}/>)}</span>{level==='unknown'?'Uncertainty: not enough data':`Uncertainty: ${level}`}</span>;}
