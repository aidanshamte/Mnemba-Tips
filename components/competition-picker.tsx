'use client';
import {useRef,useState} from 'react';
type Competition={id:string;name:string;providerIds?:string[];fixtureCount?:number};
export default function CompetitionPicker({competitions,value,onChange}:{competitions:Competition[];value:string;onChange:(value:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[query,setQuery]=useState('');
 const selected=competitions.find(c=>(c.providerIds??[c.id]).join(',')===value);
 function select(next:string){onChange(next);dialog.current?.close();}
 return <div className="competition-picker"><button aria-label="Competition" aria-haspopup="dialog" onClick={()=>{setQuery('');dialog.current?.showModal();}}>{selected?.name??'All competitions'} <span aria-hidden="true">⌄</span></button>
 <dialog ref={dialog} className="competition-dialog" aria-labelledby="competition-title" onClick={event=>{if(event.target===dialog.current)dialog.current.close();}}><div className="competition-dialog-head"><h2 id="competition-title">Find your competition</h2><button aria-label="Close competition picker" onClick={()=>dialog.current?.close()}>✕</button></div><input autoFocus aria-label="Search competitions" placeholder="Try La Liga or Champions League" value={query} onChange={e=>setQuery(e.target.value)}/><div className="competition-options"><button onClick={()=>select('')} aria-pressed={!value}>All competitions</button>{competitions.filter(c=>c.name.toLowerCase().includes(query.toLowerCase())).map(c=><button key={c.id} aria-pressed={selected?.id===c.id} onClick={()=>select((c.providerIds??[c.id]).join(','))}><span>{c.name}</span><small>{c.fixtureCount??0} records</small></button>)}{!competitions.some(c=>c.name.toLowerCase().includes(query.toLowerCase()))&&<p>No matching competition in imported coverage.</p>}</div></dialog></div>;
}
