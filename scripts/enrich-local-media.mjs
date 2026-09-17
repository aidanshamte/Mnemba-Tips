import {localOrigin} from './local-origin.mjs';
import {internalHeaders} from './internal-access.mjs';
import {appendFileSync,mkdirSync} from 'node:fs';
const origin=await localOrigin();mkdirSync('outputs/media',{recursive:true});
for(let batch=0;batch<12;batch++){const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job:'media'}),signal:AbortSignal.timeout(120000)});const result=await r.json();const line=JSON.stringify({at:new Date().toISOString(),batch,status:r.status,...result});console.log(line);appendFileSync('outputs/media/enrichment-batches.jsonl',line+'\n');if(!r.ok||result.skipped||!result.processed)break;}
