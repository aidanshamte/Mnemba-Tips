import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';import {populatedLocalDatabase} from './local-database.mjs';
import {logoName} from '../lib/football/logo-discovery.mjs';import {downloadLogo} from '../lib/football/image-validation.mjs';
import {saveMedia} from '../lib/football/media-registry.mjs';import {ownerLogoPermission} from '../lib/football/logo-permission.mjs';
const root='.sites-runtime/logo-completion',audit=JSON.parse(readFileSync('.sites-runtime/real-logos/coverage.json'));
const html=readFileSync(root+'/uganda-villa.html','utf8');
const links=[...new Set([...html.matchAll(/href="(https:\/\/upl\.co\.ug\/team\/[-a-z0-9]+\/)"/g)].map(m=>m[1]))];
const {store,sqlite}=database(populatedLocalDatabase());let owner;const report=[];
try{owner=await store.lock('football-sync',600000);if(!owner)throw Error('Another update is running');
 for(const t of audit.teams.filter(t=>t.state!=='valid'&&t.countries.includes('Uganda'))){const entry={id:t.id,name:t.name};try{
  const matches=links.filter(url=>logoName(new URL(url).pathname.split('/')[2].replaceAll('-',' '))===logoName(t.name));if(matches.length!==1)throw Error('No unique official league team link');
  const sourceUrl=matches[0],file=root+'/uganda-'+new URL(sourceUrl).pathname.split('/')[2]+'.html';let page;
  if(existsSync(file))page=readFileSync(file,'utf8');else{const r=await fetch(sourceUrl,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Official profile HTTP '+r.status);page=await r.text();writeFileSync(file,page);}
  const heading=page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').trim();if(logoName(heading)!==logoName(t.name))throw Error('Official profile heading does not match');
  const tag=(page.match(/<img\b[^>]+>/gi)??[]).find(tag=>/attachment-newspack-featured-image/.test(tag));const url=tag?.match(/\bsrc="([^"]+)"/)?.[1];
  if(!url?.startsWith('https://upl.co.ug/wp-content/uploads/')||!/\.(png|jpe?g|webp)$/i.test(url))throw Error('No official profile crest image');
  const {metadata}=await downloadLogo(url);for(const id of t.providerIds)await saveMedia(store,{id,type:'team'},'badge',{url,sourceUrl,sourceEntityId:new URL(sourceUrl).pathname,...metadata,...ownerLogoPermission(),attribution:'Uganda Premier League official club profile; club mark belongs to its owner',lastSuccess:store.now()},'Exact official league profile heading and team URL; recorded Uganda competition membership');
  Object.assign(entry,{state:'valid',sourceUrl,url,...metadata});
 }catch(error){Object.assign(entry,{state:'unresolved',error:error.message});}report.push(entry);writeFileSync(root+'/uganda-discovery.json',JSON.stringify(report,null,2));console.log(entry.name,entry.state,entry.error??'');}
}finally{if(owner)await store.unlock('football-sync',owner);sqlite.close();}
