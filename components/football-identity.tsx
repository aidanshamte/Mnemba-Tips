'use client';
import {useEffect,useState,useRef,type CSSProperties} from 'react';
import {resolveVisual} from '@/lib/football/visuals.mjs';
type Catalog={team?:Record<string,Record<string,unknown>>;competition?:Record<string,Record<string,unknown>>};
export type BadgeVariant='tiny'|'small'|'medium'|'large'|'hero';
const variantPixels={tiny:22,small:32,medium:48,large:72,hero:112};
type Props={id?:string;name:string;size?:number;variant?:BadgeVariant;country?:string;badgeOnly?:boolean;decorative?:boolean};
let request:Promise<Catalog>|null=null,expires=0;
const failedUrls=new Set<string>();
function catalog(){if(!request||Date.now()>expires){expires=Date.now()+300000;request=fetch('/api/intelligence?view=visuals').then(r=>{if(!r.ok)throw Error('Visual metadata unavailable');return r.json() as Promise<Catalog>;}).catch(()=>{expires=0;return {};});}return request!;}
export function IdentityBadge({id,name,size,variant='small',kind='team',decorative=false}:Props&{kind?:'team'|'competition'}){
 const element=useRef<HTMLSpanElement>(null);
 const [data,setData]=useState<Catalog>({}),[loaded,setLoaded]=useState(''),[failed,setFailed]=useState('');
 useEffect(()=>{let active=true;void catalog().then(value=>{if(active)setData(value);});return()=>{active=false;};},[]);
 const visual=resolveVisual({id,name},kind,data),url=visual.logoUrl as string|null;
 useEffect(()=>{if(!url||loaded===url)return;let timer:ReturnType<typeof setTimeout>|undefined;const start=()=>{timer??=setTimeout(()=>{failedUrls.add(url);setFailed(url);},8000);};const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){start();observer?.disconnect();}});if(observer&&element.current)observer.observe(element.current);else start();return()=>{clearTimeout(timer);observer?.disconnect();};},[url,loaded]);
 const usable=url&&failed!==url&&!failedUrls.has(url),real=usable&&loaded===url;
 const pixels=size??variantPixels[variant];
 // Presentation only: this immutable verified PNG has artwork at (0,45,139,90)
 // inside a 139x181 canvas. Fit the artwork width without clipping any crest pixels.
 const artworkScale=data[kind]?.[id??'']?.contentHash==='d7aff81d6e7f491547f2a2fb48b19f548b8d8ddd374bbb757798d34133546e3d'?181/139:1;
 const badgeStyle={'--badge-size':size!=null?`${size}px`:undefined,'--badge-artwork-scale':artworkScale} as CSSProperties;
 const title=real?`${name} · ${visual.attribution} · ${visual.licenseOrPermission} · ${visual.sourceUrl}`:`${name} · Mnemba fallback, not an official ${kind==='team'?'crest':'competition logo'}`;
 return <span ref={element} className={`identity-badge team-badge ${kind}-visual badge-${variant} ${real?'has-real-badge':'mnemba-fallback'}`} style={badgeStyle} role={decorative?undefined:"img"} aria-hidden={decorative||undefined} aria-label={decorative?undefined:title} title={title} data-entity-id={id} data-visual-kind={kind}>
 {!real&&<svg viewBox="0 0 40 40" width={pixels} height={pixels} aria-hidden="true"><circle cx="20" cy="20" r="18" fill="currentColor" opacity=".09"/><circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1" opacity=".35"/><text x="20" y="24" textAnchor="middle" fill="currentColor" fontSize="12" fontFamily="system-ui,sans-serif" fontWeight="750">{visual.initials}</text></svg>}
 {usable&&<img src={url} alt="" width={pixels} height={pixels} loading={variant==='hero'?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" style={{opacity:real?1:0}} onLoad={()=>setLoaded(url)} onError={()=>{failedUrls.add(url);setFailed(url);}}/>}
 </span>;
}
export function TeamIdentity({badgeOnly=false,...props}:Props){return badgeOnly?<IdentityBadge {...props}/>:<span className="football-identity"><IdentityBadge {...props} decorative/><span>{props.name}{props.country&&<small> · {props.country}</small>}</span></span>;}
export function CompetitionIdentity({badgeOnly=false,...props}:Props){return badgeOnly?<IdentityBadge {...props} kind="competition"/>:<span className="football-identity"><IdentityBadge {...props} kind="competition" decorative/><span>{props.name}</span></span>;}
