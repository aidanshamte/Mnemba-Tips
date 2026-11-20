import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';import {populatedLocalDatabase} from './local-database.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';import {downloadLogo} from '../lib/football/image-validation.mjs';import {saveMedia} from '../lib/football/media-registry.mjs';
const country=process.argv[2]??'Tanzania',audit=JSON.parse(readFileSync('.sites-runtime/real-logos/coverage.json'));
const {store,sqlite}=database(populatedLocalDatabase()),service=new IntelligenceService(store,{}),permission=JSON.parse(readFileSync('config/logo-permission.json'));
const normalize=v=>String(v??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\b(fc|sc|afc|cf|football club|sports club)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const report=[];let owner;
try{sqlite.exec('PRAGMA busy_timeout=10000');await service.initialize();owner=await store.lock('football-sync',300000);if(!owner)throw Error('Another update is running');
 for(const entity of audit.teams.filter(t=>t.state!=='valid'&&t.countries.includes(country))){
  const entry={id:entity.id,name:entity.name,country,state:'unresolved',attempts:[]};
  try{const url='https://www.thesportsdb.com/api/v1/json/123/searchteams.php?'+new URLSearchParams({t:normalize(entity.name)}),data=await service.http.json('thesportsdb',url);
   const teams=(data.teams??[]).filter(t=>t.strSport==='Soccer'&&t.strCountry===country&&[t.strTeam,...String(t.strTeamAlternate??t.strAlternate??'').split(';')].some(n=>normalize(n)===normalize(entity.name)));
   entry.attempts.push({source:url,matches:teams.length});if(teams.length!==1)throw Error('Country and exact name/alias do not identify one source team');const t=teams[0],image=t.strBadge??t.strTeamBadge;if(!image)throw Error('Exact source team has no logo');
   const {metadata}=await downloadLogo(image),sourceUrl='https://www.thesportsdb.com/team/'+t.idTeam;
   for(const id of entity.providerIds)await saveMedia(store,{id,type:'team'},'badge',{url:image,...metadata,sourceUrl,originalUrl:image,sourceEntityId:'thesportsdb:'+t.idTeam,publicDisplayAllowed:true,permissionEvidence:permission.reference,usageBasis:'Project-owner permission: '+permission.reference,attribution:'TheSportsDB; club mark belongs to its owner',lastSuccess:store.now()},'Exact unique provider name/alias + '+country+' fixture membership; source team '+t.idTeam);
   Object.assign(entry,{state:'valid',image,...metadata});
  }catch(e){entry.error=e.message;}
  report.push(entry);console.log(entry.name,entry.state,entry.error??'');writeFileSync('.sites-runtime/real-logos/discovery-'+country+'.json',JSON.stringify(report,null,2));
 }
}finally{if(owner)await store.unlock('football-sync',owner);sqlite.close();}
