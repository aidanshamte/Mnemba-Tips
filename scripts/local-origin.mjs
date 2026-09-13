// One worker process must own the local SQLite files. Prefer the active preview.
export async function localOrigin(){
 if(process.env.MNEMBA_ORIGIN)return process.env.MNEMBA_ORIGIN;
 for(const origin of ['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8787']){
  try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(10000)});const data=await r.json();if(r.ok&&Array.isArray(data.sports)&&data.sports.includes('soccer'))return origin;}catch{}
 }
 return 'http://127.0.0.1:8787';
}
export async function rejectOtherServer(port){
 try{const r=await fetch(`http://localhost:${port}/api/health`,{signal:AbortSignal.timeout(10000)});const d=await r.json();if(r.ok&&Array.isArray(d.sports)&&d.sports.includes('soccer'))throw Error(`Mnemba Tips is already running at http://localhost:${port}. Stop that server before starting another worker against the same local SQLite database.`);}catch(error){if(error.message.startsWith('Mnemba Tips is already running'))throw error;}
}

// Atomic lease covers simultaneous startups; a dead process lease is recoverable.
export async function acquireServerLease(origin){
 const {mkdirSync,writeFileSync,readFileSync,unlinkSync}=await import('node:fs');
 const root=new URL('../.sites-runtime/',import.meta.url),file=new URL('server-owner.json',root);mkdirSync(root,{recursive:true});
 const claim=()=>writeFileSync(file,JSON.stringify({pid:process.pid,origin,startedAt:new Date().toISOString()}),{flag:'wx'});
 try{claim();}catch(error){if(error.code!=='EEXIST')throw error;const previous=JSON.parse(readFileSync(file,'utf8'));try{process.kill(previous.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;unlinkSync(file);return acquireServerLease(origin);}throw Error(`Another local worker owns this database (${previous.origin}, PID ${previous.pid}). Stop it before starting a second server.`);}
 process.once('exit',()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{}});
}
