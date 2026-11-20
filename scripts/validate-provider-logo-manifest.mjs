import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {downloadLogo} from '../lib/football/image-validation.mjs';import {liveScoreLogoCandidate,liveScoreCompetitionLogoCandidate} from '../lib/football/logo-discovery.mjs';import {ownerLogoPermission} from '../lib/football/logo-permission.mjs';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Input/output manifest paths required');
const sources=JSON.parse(readFileSync(input)),report=existsSync(output)?JSON.parse(readFileSync(output)):{at:Date.now(),entries:[],failures:[]},downloads=new Map();let cursor=0;
async function next(){for(;;){const index=cursor++;if(index>=sources.length)return;const row=sources[index];if(report.entries.some(e=>e.entity.id===row.id&&e.entity.name===row.name&&e.media.lastSuccess>Date.now()-86400000))continue;report.failures=report.failures.filter(e=>e.id!==row.id);try{
 const eventId=(row.sourceUrl??'').match(/\/scoreboard\/soccer\/(\d+)$/)?.[1];
 const candidate=row.provider==='thesportsdb'&&/^thesportsdb:\d+$/.test(row.id)&&row.id==='thesportsdb:'+row.sourceEntityId&&/^https:\/\/(?:r2|www)\.thesportsdb\.com\/images\/media\/(?:team|league)\/badge\//.test(row.imageReference)?{url:row.imageReference,sourceUrl:'https://www.thesportsdb.com/'+(row.type==='competition'?'league/':'team/')+row.sourceEntityId,sourceEntityId:row.id,country:row.country,entityName:row.name,basis:'Exact persisted TheSportsDB identity and badge reference from the same record',attribution:'TheSportsDB; mark belongs to its owner'}:row.type==='competition'?liveScoreCompetitionLogoCandidate({Sid:row.sourceEntityId,Snm:row.name,badgeUrl:row.imageReference,Cnm:row.country},eventId):liveScoreLogoCandidate({ID:row.sourceEntityId,Nm:row.name,Img:row.imageReference,CoNm:row.country,Gd:row.gender,Spid:row.sport},eventId);
 if(!candidate||candidate.sourceEntityId!==row.id)throw Error('Exact provider image identity required');
 let metadata,lastError;for(const url of [candidate.url,...(candidate.alternateUrls??[])]){try{let promise=downloads.get(url);if(!promise){promise=downloadLogo(url);downloads.set(url,promise);}metadata=(await promise).metadata;candidate.url=url;break;}catch(error){lastError=error;}}if(!metadata)throw lastError;
 report.entries.push({entity:{id:row.id,name:row.name,type:row.type??'team'},basis:candidate.basis,media:{...candidate,...metadata,...ownerLogoPermission(),lastSuccess:Date.now()}});
 }catch(error){report.failures.push({id:row.id,name:row.name,error:error.message});}
 writeFileSync(output,JSON.stringify(report,null,2));if((report.entries.length+report.failures.length)%100===0)console.log(JSON.stringify({processed:report.entries.length+report.failures.length,valid:report.entries.length,failed:report.failures.length}));
 await new Promise(r=>setTimeout(r,150));
}}
await Promise.all(Array.from({length:4},next));console.log(JSON.stringify({valid:report.entries.length,failed:report.failures.length}));
