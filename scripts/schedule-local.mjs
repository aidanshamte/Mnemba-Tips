import {internalHeaders} from './internal-access.mjs';
import {localOrigin} from './local-origin.mjs';
// Cross-platform foreground scheduler. Stops when this process/Codespace stops.
import './sites-env.mjs';
import {appendFileSync,existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {backupLocal} from './backup-local.mjs';
const origin=await localOrigin();
const stateFile='.sites-runtime/scheduler-state.json',lease='.sites-runtime/scheduler.lock';
const log=event=>{const line=JSON.stringify({at:new Date().toISOString(),...event});console.log(line);appendFileSync('.sites-runtime/scheduler.jsonl',line+'\n');};
let owner=false;
try{writeFileSync(lease,String(process.pid),{flag:'wx'});owner=true;}catch{const pid=Number(readFileSync(lease,'utf8'));try{process.kill(pid,0);throw Error('Scheduler already running');}catch(e){if(e.code!=='ESRCH')throw e;}unlinkSync(lease);writeFileSync(lease,String(process.pid),{flag:'wx'});owner=true;}
let stopped=false;const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const jobs=['fixtures','results','models','snapshots','news','video-news','retention','search-index'];
try{do{
 try{
  const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{};
  if(!state.backupAt||Date.now()-state.backupAt>86400000){log({backup:await backupLocal()});state.backupAt=Date.now();writeFileSync(stateFile,JSON.stringify(state));}
  const response=await fetch(origin+'/api/intelligence?view=sources',{headers:internalHeaders(),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Local diagnostics HTTP ${response.status}`);const data=await response.json();
  for(const job of jobs){if(stopped)break;const previous=data.jobs.find(j=>j.id===job);if(previous?.next_run>Date.now())continue;
   const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job}),signal:AbortSignal.timeout(540000)});const result=await r.json();log({job,httpStatus:r.status,result});if(result.skipped)break;
  }
 }catch(error){log({error:error.message});}
 if(process.argv.includes('--once'))break;
 // Short sleeps allow prompt signal handling. Provider retries/budgets live in SourceHttp.
 for(let i=0;i<60&&!stopped;i++)await new Promise(r=>setTimeout(r,1000));
}while(!stopped);}finally{if(owner)unlinkSync(lease);}
