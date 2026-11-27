'use client';
import {TeamIdentity,CompetitionIdentity} from './football-identity';
import ForecastArchive,{type Version} from './forecast-archive';
import LocalTime,{useTimeZone} from './local-time';
import {matchPick} from '@/lib/football/confidence.mjs';
type Side={id?:string;name:string};
export type HistoryMatch={fixture:{id:string;startsAt:number;kickoffPrecision?:string;status:string;competition?:{id?:string;name:string};home:Side;away:Side};archive:{original?:Version;selected?:Version;versions:Version[];exploratory?:{id:string;createdAt:number;payload?:Version['payload']}[]}};
/** One settled or pending prediction: score, the counted prediction, its result, and (collapsed) every saved version. */
export default function ResultRow({m}:{m:HistoryMatch}){
 const {zone}=useTimeZone(),f=m.fixture,v=m.archive.selected,g=v?.grade,p=v?.payload.probabilities;
 const pick=p?matchPick({probabilities:p},f):null;
 const state=!v?null:g?(g.resultCorrect===null?'Void':g.resultCorrect?'Correct':'Incorrect'):/void/i.test(v.gradeState)?'Void':'Pending';
 return <article className="intel-panel result-row">
  <p className="result-meta"><CompetitionIdentity id={f.competition?.id} name={f.competition?.name??'Competition unverified'}/> · <LocalTime fixture={f}/></p>
  <a className="result-teams" href={`/football/match/${encodeURIComponent(f.id)}`}><span><TeamIdentity id={f.home.id} name={f.home.name}/></span><b>{g?.homeScore??'–'}</b><span><TeamIdentity id={f.away.id} name={f.away.name}/></span><b>{g?.awayScore??'–'}</b></a>
  {pick?<p className="result-pick">Prediction <b>{pick.pick}</b> {Math.round(pick.probability*100)}%</p>:<p className="result-pick result-muted">No tracked prediction{m.archive.exploratory?.length?' · early previews only':''}</p>}
  {state&&<p className={`result-state result-${state.toLowerCase()}`}>{state}{state==='Correct'?' ✓':''}</p>}
  {v&&<p className="result-saved">Saved {new Date(v.createdAt).toLocaleString('en-GB',{timeZone:zone??'UTC',dateStyle:'medium',timeStyle:'short'})}</p>}
  <details className="result-more"><summary>Saved versions</summary><ForecastArchive archive={m.archive}/></details>
 </article>;
}
