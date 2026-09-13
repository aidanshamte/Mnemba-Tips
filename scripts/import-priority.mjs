import {internalHeaders} from './internal-access.mjs';
import {localOrigin} from './local-origin.mjs';
// Imports discovered, CC0 OpenFootball files through the application database.
import {mkdirSync,appendFileSync} from 'node:fs';
const origin=await localOrigin();
const response=await fetch(origin+'/api/intelligence?view=files',{headers:internalHeaders()});
if(!response.ok)throw Error(`File catalog HTTP ${response.status}`);
const {files}=await response.json();
const year=new Date().getUTCFullYear(),season=y=>`${y}-${String(y+1).slice(-2)}`;
const paths=['es','it','fr','en'].flatMap(code=>[year-1,year].map(y=>`${season(y)}/${code}.1.json`));
mkdirSync('outputs',{recursive:true});
for(const path of paths){
 const file=files.find(f=>f.repository==='football.json'&&f.path===path);
 let result;if(!file)result={state:'not-published'};
 else if(file.state==='imported'&&file.last_import>Date.now()-1800000)result={state:'cached',fixtures:file.fixture_count};
 else {
  for(let attempt=1;attempt<=3;attempt++){
   try{const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job:'history',fileId:file.id}),signal:AbortSignal.timeout(540000)});const body=await r.text();try{result=JSON.parse(body);}catch{throw Error(`HTTP ${r.status}: ${body.slice(0,150)}`);}if(!r.ok)throw Error(result.error??`HTTP ${r.status}`);if(result.outcome!=='success')process.exitCode=1;break;}
   catch(error){result={state:'error',attempt,error:error.message};appendFileSync('outputs/priority-imports.jsonl',JSON.stringify({at:new Date().toISOString(),path,...result})+'\n');if(attempt===3)process.exitCode=1;else await new Promise(r=>setTimeout(r,2000*attempt));}
  }
 }
 const line=JSON.stringify({at:new Date().toISOString(),path,...result});console.log(line);appendFileSync('outputs/priority-imports.jsonl',line+'\n');
}
