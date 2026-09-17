'use client';
import {useEffect,useState} from 'react';
import {safeImage} from '@/lib/football/media-policy.mjs';
export default function EntityPortrait({id,name,media,compact=false}:{id?:string;name:string;media?:Record<string,any>;compact?:boolean}){
 const [resolved,setResolved]=useState<{id:string;item:Record<string,any>|null}|null>(null),[failed,setFailed]=useState('');
 useEffect(()=>{if(media||!id)return;const c=new AbortController();void fetch('/api/intelligence?view=media&ids='+encodeURIComponent(id),{signal:c.signal}).then(r=>r.json() as Promise<{media?:Record<string,Record<string,any>>}>).then(d=>setResolved({id,item:d.media?.[id]??null})).catch(()=>{});return()=>c.abort();},[id,media]);
 const item=media??(resolved?.id===id?resolved?.item:null),url=safeImage(item?.url),real=url&&failed!==url;
 return <span className="portrait-wrap"><span className="media-avatar" role={real?undefined:'img'} aria-label={real?undefined:`${name} — photo unavailable`} title={real?`${item?.attribution} · ${item?.usageBasis}`:'Photo unavailable'}>{real?<img src={url} alt={`${name} portrait`} width={72} height={72} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:<span className="avatar-initials" aria-hidden="true">{name.split(/\s+/).slice(0,2).map(v=>v[0]).join('')}</span>}</span>{!real&&<small>Photo unavailable</small>}{real&&(compact?<small className="compact-credit">{item?.attribution} · {item?.usageBasis}</small>:<small>{item?.attribution} · <a href={item?.sourceUrl}>Source</a> · <a href={item?.licenseUrl??item?.sourceUrl}>{item?.usageBasis}</a></small>)}</span>;
}
