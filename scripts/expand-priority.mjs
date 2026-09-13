import {localOrigin} from './local-origin.mjs';
import {internalHeaders} from './internal-access.mjs';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
const origin=await localOrigin();mkdirSync('outputs/matchday',{recursive:true});
for(let page=0;page<100;page++){
 const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job:'priority-import'}),signal:AbortSignal.timeout(540000)});const result=await r.json();appendFileSync('outputs/matchday/imports.jsonl',JSON.stringify({at:new Date().toISOString(),http:r.status,...result})+'\n');console.log(JSON.stringify({page,http:r.status,...result}));if(!r.ok)break;if(result.skipped){await new Promise(r=>setTimeout(r,5000));continue;}if(!result.files?.length||result.files.every(f=>f.state==='failed'))break;
}
const r=await fetch(origin+'/api/intelligence?view=coverage',{headers:internalHeaders()});writeFileSync('outputs/matchday/coverage.json',JSON.stringify(await r.json(),null,2));
