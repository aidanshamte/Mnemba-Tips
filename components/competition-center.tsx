'use client';
import {useEffect,useState} from 'react';
import PublicNav from './public-nav';
import LocalTime from './local-time';
import TeamBadge from './team-badge';
export default function CompetitionCenter({id}:{id:string}){const [data,setData]=useState<Record<string,any>|null>(null);useEffect(()=>{void fetch(`/api/intelligence?view=competition&id=${encodeURIComponent(id)}`).then(r=>r.json()).then(d=>setData(d as Record<string,any>));},[id]);return <div className="intel"><main className="match-center"><PublicNav/><h1>{data?.competition?.name??'Competition explorer'}</h1><p>Recorded results and schedules · source coverage varies by season</p><div className="intel-matches">{data?.fixtures?.map((f:Record<string,any>)=><a className="intel-match" key={f.id} href={`/football/match/${encodeURIComponent(f.id)}`}><h3><TeamBadge id={f.home.id} name={f.home.name}/>{f.home.name} — <TeamBadge id={f.away.id} name={f.away.name}/>{f.away.name}</h3><p><LocalTime fixture={{startsAt:f.startsAt,kickoffPrecision:f.kickoffPrecision}}/> · {f.label} · {f.homeScore??'—'} : {f.awayScore??'—'}</p></a>)}</div></main></div>;}
