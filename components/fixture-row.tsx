'use client';
// Figma: Compact fixture row + competition group header (Fixtures screen).
// Rendered inside client components; uses only real fixture fields.
import {ChevronRight,Star} from 'lucide-react';
import {useFavouriteLeagues} from './use-favourite-leagues';
import {orderByCompetition} from '@/lib/football/featured-competitions.mjs';
import {IdentityBadge,CompetitionIdentity} from './football-identity';
import LocalTime from './local-time';
import {StatusTag,matchStatusKind} from './mt-ui';
type Side={id?:string;name?:string};
type AnalysisState={state:'full'|'provisional'|'waiting';label:string;reason?:string;main?:{outcome:string;probability:number}|null};
type Fixture={id:string;status?:string;kickoffPrecision?:string;startsAt:number;homeScore?:number|null;awayScore?:number|null;home?:Side;away?:Side;competition?:{id?:string;name:string};competitionCanonical?:string;competitionName?:string;analysisState?:AnalysisState};

export function FixtureRow({f}:{f:Fixture}){
 const kind=matchStatusKind(f.status,f.kickoffPrecision,f.startsAt),scored=f.homeScore!=null&&f.awayScore!=null;
 return <a className="mt-fixture-row" href={`/football/match/${encodeURIComponent(f.id)}`}>
  <span className="mt-fixture-when"><LocalTime fixture={{startsAt:f.startsAt,kickoffPrecision:f.kickoffPrecision}}/>{kind!=='scheduled'&&<StatusTag kind={kind}/>}{kind==='scheduled'&&f.analysisState&&<span className={`mt-analysis-chip mt-analysis-${f.analysisState.state}`} title={f.analysisState.reason}>{f.analysisState.label}{f.analysisState.main?` · ${f.analysisState.main.outcome} ${Math.round(f.analysisState.main.probability*100)}%`:''}</span>}</span>
  <span className="mt-fixture-team mt-fixture-home"><span className="mt-team-name mt-clamp-2">{f.home?.name}</span><IdentityBadge id={f.home?.id} name={f.home?.name??'Home team'} variant="small" decorative/></span>
  <span className="mt-fixture-score" aria-label={scored?`Score ${f.homeScore} to ${f.awayScore}`:undefined}>{scored?`${f.homeScore} : ${f.awayScore}`:'vs'}</span>
  <span className="mt-fixture-team mt-fixture-away"><IdentityBadge id={f.away?.id} name={f.away?.name??'Away team'} variant="small" decorative/><span className="mt-team-name mt-clamp-2">{f.away?.name}</span></span>
  <ChevronRight className="mt-fixture-go" aria-hidden="true" size={20}/>
 </a>;
}

/** Group fixtures by canonical competition: favourites, then featured, then the rest; matches chronological inside each group. */
export function FixtureGroups({fixtures}:{fixtures:Fixture[]}){
 const {favourites,isFavourite,toggle}=useFavouriteLeagues();
 const groups=new Map<string,{key:string;canonical?:string;competition:Fixture['competition'];items:Fixture[]}>();
 for(const f of fixtures){// Providers can list one competition under different IDs; the canonical id (or the displayed name) joins them.
 const key=f.competitionCanonical??String(f.competition?.name??f.competition?.id??'other').toLowerCase();
 if(!groups.has(key))groups.set(key,{key,canonical:f.competitionCanonical,competition:f.competitionName&&f.competition?{...f.competition,name:f.competitionName}:f.competition,items:[]});
 const g=groups.get(key)!;if(!g.items.some(x=>x.id===f.id))g.items.push(f);}
 type Group={key:string;canonical?:string;competition:Fixture['competition'];items:Fixture[]};
 // Different leagues can share a display name (Serbia's and Slovakia's "Super Liga"); add the country so headers stay distinct.
 const named=new Map<string,number>();for(const g of groups.values()){const n=g.competition?.name??'';named.set(n,(named.get(n)??0)+1);}
 for(const g of groups.values())if(g.competition&&g.canonical&&(named.get(g.competition.name)??0)>1){const c=g.canonical.split(':')[1]??'';g.competition={...g.competition,name:`${g.competition.name} · ${c.split('-').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ')}`};}
 const ordered:Group[]=orderByCompetition([...groups.values()],(g:Group)=>g.canonical??'',favourites);
 return <div className="mt-fixture-groups">{ordered.map(g=>{const name=g.competition?.name??'Other fixtures',fav=!!g.canonical&&isFavourite(g.canonical);
  return <section key={g.key} className="mt-fixture-group" aria-label={name}>
  <header className="mt-fixture-group-head">{g.competition?<CompetitionIdentity id={g.competition.id} name={g.competition.name} variant="medium"/>:<span>Other fixtures</span>}
   <span className="mt-group-tail"><small>{g.items.length} {g.items.length===1?'match':'matches'}</small>
   {g.canonical&&<button type="button" className="mt-pin" aria-pressed={fav} aria-label={fav?`Unpin ${name}`:`Pin ${name} to the top`} title={fav?'Pinned on this device':'Pin to the top on this device'} onClick={()=>toggle(g.canonical!)}><Star size={16} aria-hidden fill={fav?'currentColor':'none'}/></button>}</span></header>
  {[...g.items].sort((a,b)=>a.startsAt-b.startsAt).map(f=><FixtureRow key={f.id} f={f}/>)}
 </section>;})}</div>;
}
