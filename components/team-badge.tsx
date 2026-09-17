'use client';
import Image from 'next/image';
import {useEffect,useState} from 'react';
import {badgeUrl} from '@/lib/football/public-enrichment.mjs';
type Badge={url:string};
let request:Promise<Record<string,Badge>>|null=null;
export default function TeamBadge({id,name,logo}:{id?:string;name:string;logo?:string|null}){
 const [resolved,setResolved]=useState<{id:string;url:string|null}|null>(null),[failed,setFailed]=useState('');
 useEffect(()=>{if(!id)return;request??=fetch('/api/intelligence?view=badges').then(r=>r.json() as Promise<{badges:Record<string,Badge>}>).then(d=>d.badges??{}).catch(()=>{request=null;return {};});let active=true;void request.then(b=>{if(active){setResolved({id,url:b[id]?.url??null});}});return()=>{active=false;};},[id]);
 const safe=badgeUrl(id?(resolved?.id===id?resolved.url:null):logo),broken=failed===safe;
 return <span className={`team-badge ${safe&&!broken?'has-real-badge':'monogram-shield'}`} role="img" aria-label={safe&&!broken?`${name} badge`:`${name} monogram — official badge unavailable`} title={safe&&!broken?`${name} badge`:`${name} · badge unavailable`}><span aria-hidden="true">{name.split(/\s+/).filter(w=>!['FC','CF','AC'].includes(w)).slice(0,2).map(w=>w[0]).join('')}</span>{safe&&!broken&&<Image unoptimized src={safe} alt={`${name} team badge`} width={36} height={36} loading="lazy" decoding="async" onError={()=>setFailed(safe!)}/>}</span>;
}
