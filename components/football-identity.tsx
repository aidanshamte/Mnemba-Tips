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
 const title=real?`${name} · ${visual.attribution} · ${visual.licenseOrPermission} · ${visual.sourceUrl}`:`${name} · ${kind==='team'?'badge':'emblem'} unavailable from a permitted source`;
 return <span ref={element} className={`identity-badge team-badge ${kind}-visual badge-${variant} ${real?'has-real-badge':'mnemba-fallback'}`} style={badgeStyle} role={decorative?undefined:"img"} aria-hidden={decorative||undefined} aria-label={decorative?undefined:title} title={title} data-entity-id={id} data-visual-kind={kind}>
 {!real&&<svg className="badge-fallback" viewBox="0 0 24 24" width={pixels} height={pixels} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={pixels>=48?1.5:2} strokeLinecap="round" strokeLinejoin="round">{kind==="team"?<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>:<><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></>}</svg>}
 {usable&&<img src={url} alt="" width={pixels} height={pixels} loading={variant==='hero'?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" style={{opacity:real?1:0}} onLoad={()=>setLoaded(url)} onError={()=>{failedUrls.add(url);setFailed(url);}}/>}
 </span>;
}
export function TeamIdentity({badgeOnly=false,...props}:Props){return badgeOnly?<IdentityBadge {...props}/>:<span className="football-identity"><IdentityBadge {...props} decorative/><span>{props.name}{props.country&&<small> · {props.country}</small>}</span></span>;}
export function CompetitionIdentity({badgeOnly=false,...props}:Props){return badgeOnly?<IdentityBadge {...props} kind="competition"/>:<span className="football-identity"><IdentityBadge {...props} kind="competition" decorative/><span>{props.name}</span></span>;}
