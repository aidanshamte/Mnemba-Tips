import {env} from 'cloudflare:workers';
import {Store} from '@/lib/football/store.mjs';
import {liveSnapshot} from '@/lib/football/live.mjs';
import {liveStream} from '@/lib/football/live-stream.mjs';
export const dynamic='force-dynamic';
// Shared process-local read coalescing, bounded against arbitrary public IDs.
const reads=new Map<string,{at:number,value:ReturnType<typeof liveSnapshot>}>();
export async function GET(request:Request){
 const url=new URL(request.url),id=url.searchParams.get('id');
 if(!id||id.length>240)return Response.json({error:'Match ID required'},{status:400});
 const store=new Store((env as unknown as {DB:ConstructorParameters<typeof Store>[0]}).DB);store.readOnly=true;
 const read=()=>{const previous=reads.get(id);if(previous&&Date.now()-previous.at<4000)return previous.value;if(reads.size>=500)reads.delete(reads.keys().next().value!);const value=liveSnapshot(store,id);reads.set(id,{at:Date.now(),value});value.catch(()=>reads.delete(id));return value;};
 if(url.searchParams.get('stream')==='1')return liveStream(read,{signal:request.signal});
 try{return Response.json(await read(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Live state temporarily unavailable'},{status:503});}
}
