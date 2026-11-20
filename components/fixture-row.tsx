// Figma: Compact fixture row + competition group header (Fixtures screen).
// Rendered inside client components; uses only real fixture fields.
import {ChevronRight} from 'lucide-react';
import {IdentityBadge,CompetitionIdentity} from './football-identity';
import LocalTime from './local-time';
import {StatusTag,matchStatusKind} from './mt-ui';
type Side={id?:string;name?:string};
type Fixture={id:string;status?:string;kickoffPrecision?:string;startsAt:number;homeScore?:number|null;awayScore?:number|null;home?:Side;away?:Side;competition?:{id?:string;name:string}};

export function FixtureRow({f}:{f:Fixture}){
 const kind=matchStatusKind(f.status,f.kickoffPrecision,f.startsAt),scored=f.homeScore!=null&&f.awayScore!=null;
 return <a className="mt-fixture-row" href={`/football/match/${encodeURIComponent(f.id)}`}>
  <span className="mt-fixture-when"><LocalTime fixture={{startsAt:f.startsAt,kickoffPrecision:f.kickoffPrecision}}/>{kind!=='scheduled'&&<StatusTag kind={kind}/>}</span>
  <span className="mt-fixture-team mt-fixture-home"><span className="mt-team-name mt-clamp-2">{f.home?.name}</span><IdentityBadge id={f.home?.id} name={f.home?.name??'Home team'} variant="small" decorative/></span>
  <span className="mt-fixture-score" aria-label={scored?`Score ${f.homeScore} to ${f.awayScore}`:undefined}>{scored?`${f.homeScore} : ${f.awayScore}`:'vs'}</span>
  <span className="mt-fixture-team mt-fixture-away"><IdentityBadge id={f.away?.id} name={f.away?.name??'Away team'} variant="small" decorative/><span className="mt-team-name mt-clamp-2">{f.away?.name}</span></span>
  <ChevronRight className="mt-fixture-go" aria-hidden="true" size={20}/>
 </a>;
}

/** Group fixtures by competition, keeping the order the API returned. */
export function FixtureGroups({fixtures}:{fixtures:Fixture[]}){
 const groups=new Map<string,{competition:Fixture['competition'];items:Fixture[]}>();
 for(const f of fixtures){// Providers can list the same competition under different IDs; group by the displayed name.
 const key=String(f.competition?.name??f.competition?.id??'other').toLowerCase();if(!groups.has(key))groups.set(key,{competition:f.competition,items:[]});groups.get(key)!.items.push(f);}
 return <div className="mt-fixture-groups">{[...groups.entries()].map(([key,g])=><section key={key} className="mt-fixture-group" aria-label={g.competition?.name??'Other fixtures'}>
  <header className="mt-fixture-group-head">{g.competition?<CompetitionIdentity id={g.competition.id} name={g.competition.name} variant="medium"/>:<span>Other fixtures</span>}<small>{g.items.length} {g.items.length===1?'match':'matches'}</small></header>
  {g.items.map(f=><FixtureRow key={f.id} f={f}/>)}
 </section>)}</div>;
}
