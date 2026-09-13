import {localOrigin} from './local-origin.mjs';
import {internalHeaders} from './internal-access.mjs';
import {writeFileSync} from 'node:fs';
const origin=await localOrigin(),results=[];
for(const job of ['badges','players','search-index']){const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job}),signal:AbortSignal.timeout(540000)});const result=await r.json();results.push({job,status:r.status,result});console.log(JSON.stringify(results.at(-1)));writeFileSync('outputs/page-upgrade/imports.json',JSON.stringify(results,null,2));}
