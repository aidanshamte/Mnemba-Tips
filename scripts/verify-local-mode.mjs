import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {localOrigin} from './local-origin.mjs';
import {internalHeaders} from './internal-access.mjs';
const origin=await localOrigin(),report={origin,pages:[],history:[],data:[]};
for(const path of ['/','/football','/football/predictions','/football/search','/football/shortlists','/football/markets','/lab','/api/health']){const r=await fetch(origin+path);assert.ok(r.ok,`${path}: ${r.status}`);report.pages.push({path,status:r.status,url:r.url});}
for(const tab of ['today','yesterday','week','pending','completed','exploratory','all']){const r=await fetch(origin+'/api/intelligence?'+new URLSearchParams({view:'prediction-history',tab,timezone:'UTC'}));assert.ok(r.ok);const d=await r.json();report.history.push({tab,matches:d.matches.length,next:d.nextOffset,previews:d.matches.reduce((n,m)=>n+m.archive.exploratory.length,0)});if(tab==='exploratory')assert.ok(d.matches.length>0);}
for(const view of ['fixtures','catalog','overview','news','markets','global-search','performance']){const r=await fetch(origin+'/api/intelligence?'+new URLSearchParams({view,q:'Messi',kind:'player'}),{headers:internalHeaders()});assert.ok(r.ok,`${view}: ${r.status}`);report.data.push({view,status:r.status});}
mkdirSync('outputs/local-mode',{recursive:true});writeFileSync('outputs/local-mode/api-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
