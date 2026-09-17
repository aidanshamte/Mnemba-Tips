'use client';
import {useState} from 'react';
import {newsMedia} from '@/lib/football/media-policy.mjs';
export default function NewsMedia({article}:{article:Record<string,any>}){
 const [failed,setFailed]=useState<string[]>([]),media=newsMedia(article,failed);
 return <div className="news-visual">{media.type!=='placeholder'?<><img src={media.url} alt={`${article.publisher}: ${article.headline}`} loading="lazy" decoding="async" sizes="(max-width:600px) 104px, (max-width:1000px) 50vw, 33vw" referrerPolicy="no-referrer" onError={()=>setFailed(urls=>[...urls,media.url])}/>{media.type==='video'&&<span className="video-label">▶ Publisher video</span>}</>:<div className="publisher-placeholder" role="img" aria-label={`${article.publisher??'Publisher'} — image unavailable`}><span>{(article.publisher??'MN').split(/\s+/).slice(0,2).map((s:string)=>s[0]).join('')}</span><strong>{article.publisher??'Mnemba Tips'}</strong><small>NEWS BRIEFING</small></div>}</div>;
}
