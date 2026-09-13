'use client';
import Image from 'next/image';
import {useEffect,useState} from 'react';
import {badgeUrl} from '@/lib/football/public-enrichment.mjs';
type Badge={url:string};
let request:Promise<Record<string,Badge>>|null=null;
export default function TeamBadge({id,name,logo}:{id?:string;name:string;logo?:string|null}){
 const [resolved,setResolved]=useState<string|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{if(!id)return;request??=fetch('/api/intelligence?view=badges').then(r=>r.json() as Promise<{badges:Record<string,Badge>}>).then(d=>d.badges??{}).catch(()=>{request=null;return {};});let active=true;void request.then(b=>{if(active){setResolved(b[id]?.url??null);setFailed(false);}});return()=>{active=false;};},[id]);
 const safe=badgeUrl(resolved??logo);
 return <span className="team-badge" title={safe&&!failed?`${name} badge`:`${name} · badge unavailable`}><span aria-hidden="true">{name.split(/\s+/).filter(w=>!['FC','CF','AC'].includes(w)).slice(0,2).map(w=>w[0]).join('')}</span>{safe&&!failed&&<Image unoptimized src={safe} alt={`${name} team badge`} width={36} height={36} onError={()=>setFailed(true)}/>}</span>;
}
