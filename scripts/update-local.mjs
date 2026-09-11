import {openSync,closeSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {backupLocal} from './backup-local.mjs';
const origin='http://127.0.0.1:8787',group=process.argv[2]??'fixtures';
const groups={bootstrap:['catalog','fixtures','results','reconcile','discover','history','entities','identities','archive','backfill','news','social','snapshots'],fixtures:['fixtures','results','snapshots','models'],hourly:['news','social','documents'],daily:['backup','discover','history','reconcile','entities','identities','backfill','mirrors','archive','calibration','retention','search-index','models','rosters'],history:['history'],discover:['discover'],backup:['backup'],reconcile:['reconcile'],news:['news'],social:['social'],entities:['entities']};
if(!groups[group])throw new Error(`Unknown update group: ${group}`);
mkdirSync('.sites-runtime',{recursive:true});const lock=resolve('.sites-runtime/update.lock');let descriptor;
try{descriptor=openSync(lock,'wx');}catch{let previous;try{previous=JSON.parse(readFileSync(lock,'utf8'));}catch{throw new Error('Update lock unreadable; inspect it before recovery');}try{process.kill(previous.pid,0);console.log(JSON.stringify({status:'deferred',reason:'An updater is already running'}));process.exit(75);}catch(e){if(e.code!=='ESRCH')throw e;}unlinkSync(lock);descriptor=openSync(lock,'wx');}
writeFileSync(descriptor,JSON.stringify({pid:process.pid,startedAt:Date.now()}));closeSync(descriptor);
function log(event){const line=JSON.stringify({at:new Date().toISOString(),...event});console.log(line);appendFileSync('.sites-runtime/updates.jsonl',line+'\n');}
async function healthy(){try{return(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).ok;}catch{return false;}}
try{if(group!=='backup'&&!await healthy()){const child=spawn(process.execPath,['scripts/start-local.mjs'],{cwd:process.cwd(),detached:true,windowsHide:true,stdio:'ignore'});child.unref();for(let i=0;i<40&&!await healthy();i++)await new Promise(r=>setTimeout(r,1000));if(!await healthy())throw new Error('Local application did not become healthy');}
let failures=0;for(const job of groups[group]){try{if(job==='backup'){log({job,result:await backupLocal()});continue;}const response=await fetch(origin+'/api/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job}),signal:AbortSignal.timeout(540000)});const result=await response.json();log({job,status:response.status,result});if(!response.ok||['partial','empty','error'].includes(result.outcome)||result.errors?.length||result.files?.some(r=>r.error||r.fixtures===0))failures++;}catch(e){failures++;log({job,error:e.message});}}process.exitCode=failures?1:0;
}finally{unlinkSync(lock);}
