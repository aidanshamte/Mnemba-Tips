import {internalHeaders} from './internal-access.mjs';
import {writeFileSync} from 'node:fs';
const origin='http://localhost:5173',reports=[];
for(const fileId of ['6058d7b1376f80d9a1195ac9837c2b976d882e83eeff0d16aff08c3df02cc2d3','08d1927193559189d68e826f6f2ca0cc33a07ef3c9542194097e2f04bae74823']){const r=await fetch(origin+'/api/intelligence',{method:'POST',headers:{...internalHeaders(),'Content-Type':'application/json'},body:JSON.stringify({job:'history',fileId}),signal:AbortSignal.timeout(240000)});const result=await r.json();reports.push({fileId,status:r.status,result});console.log(JSON.stringify(reports.at(-1)));writeFileSync('outputs/page-upgrade/history-imports.json',JSON.stringify(reports,null,2));}
