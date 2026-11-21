'use client';
import {useEffect,useState} from 'react';
type State={unavailable?:boolean;revision?:string;updatedAt:number;fixture:Record<string,unknown>;details:Record<string,unknown[]>;players:unknown[];connection?:'live'|'reconnecting'|'polling'};
export function useLiveMatch(id:string){
 const [snapshot,setSnapshot]=useState<{id:string;value:State}|null>(null),[connection,setConnection]=useState<'live'|'reconnecting'|'polling'>('polling');
 useEffect(()=>{
  let stopped=false,connected=false,source:EventSource|undefined;const controller=new AbortController();
  const apply=(value:State)=>{if(!stopped&&!value.unavailable)setSnapshot({id,value});};
  const read=async()=>{try{const r=await fetch(`/api/football/live?id=${encodeURIComponent(id)}`,{signal:controller.signal,cache:'no-store'});if(r.ok)apply(await r.json());}catch{}};
  void read();
  if(typeof EventSource!=='undefined'){
   source=new EventSource(`/api/football/live?stream=1&id=${encodeURIComponent(id)}`);
   source.onopen=()=>{connected=true;setConnection('live');};source.onerror=()=>{connected=false;setConnection('reconnecting');};
   source.addEventListener('match',event=>{try{apply(JSON.parse((event as MessageEvent).data));}catch{}});
  }
  const timer=setInterval(()=>{if(!connected&&!document.hidden)void read();},30000);
  return()=>{stopped=true;controller.abort();source?.close();clearInterval(timer);};
 },[id]);
 return snapshot?.id===id?{...snapshot.value,connection}:null;
}
