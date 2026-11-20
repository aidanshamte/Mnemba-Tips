// Short bounded streams survive proxy timeouts; reconnect always sends current state.
/** @param {() => Promise<object>} read @param {{signal?: AbortSignal, interval?: number, duration?: number}} options */
export function liveStream(read,{signal,interval=5000,duration=55000}={}){
 let timer,deadline,closed=false,last;
 const encoder=new TextEncoder();let controller;
 const close=()=>{if(closed)return;closed=true;clearTimeout(timer);clearTimeout(deadline);signal?.removeEventListener('abort',close);try{controller?.close();}catch{}};
 const stream=new ReadableStream({start(c){controller=c;signal?.addEventListener('abort',close,{once:true});if(signal?.aborted){close();return;}
  c.enqueue(encoder.encode('retry: 3000\n\n'));
  const tick=async()=>{try{const state=await read();if(closed)return;const version=state.revision??'unavailable';if(version!==last){last=version;c.enqueue(encoder.encode(`event: match\nid: ${version}\ndata: ${JSON.stringify(state)}\n\n`));}else c.enqueue(encoder.encode(': heartbeat\n\n'));}catch{close();return;}if(!closed)timer=setTimeout(tick,interval);};
  deadline=setTimeout(close,duration);void tick();
 },cancel:close});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store, no-transform','X-Accel-Buffering':'no'}});
}
