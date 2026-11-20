import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {database} from '../football-db.mjs';
import {enrichMedia,resolveBadgeCandidates} from '../../lib/football/media-registry.mjs';
import {visualCatalog} from '../../lib/football/visuals.mjs';
import {ownerLogoPermission} from '../../lib/football/logo-permission.mjs';
const pixels=()=>sharp(Buffer.from('<svg width="64" height="64"><circle cx="32" cy="32" r="24" fill="black"/></svg>')).png().toBuffer();
test('new persisted provider team and competition automatically acquire decoded permission-backed visuals',async()=>{
 const {store,sqlite}=database();try{await store.init();const bytes=await pixels();
 for(const [type,id] of [['team','501'],['competition','502']]){
  const entity={id:'thesportsdb:'+id,provider:'thesportsdb',externalId:id,name:type,[type==='team'?'logo':'badge']:'https://r2.thesportsdb.com/images/media/'+type+'/badge/'+id+'.png'};
  await store.upsert(type==='team'?'football_teams':'competitions',{id:entity.id,provider:entity.provider,external_id:id,name:type,country_id:null,...(type==='competition'?{type:'league'}:{}),payload:JSON.stringify(entity),updated_at:store.now()});
 }
 const requests=[];const service={store,env:{},http:{fetcher:async(url,options)=>{requests.push({url,method:options?.method});return new Response(bytes,{headers:{'content-type':'image/png'}});},json:async()=>{throw Error('Unexpected identity lookup');}}};
 const result=await enrichMedia(service,{visualsOnly:true});assert.equal(result.inserted,2);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.method!=='HEAD'));
 const catalog=await visualCatalog(store);assert.equal(catalog.team['thesportsdb:501'].width,64);assert.equal(catalog.competition['thesportsdb:502'].contentHash.length,64);assert.ok(catalog.team['thesportsdb:501'].permissionEvidence);
 }finally{sqlite.close();}
});
test('broken and HTML candidates persist failure and advance to the next decoded logo',async()=>{
 const {store,sqlite}=database();try{await store.init();const bytes=await pixels();const candidate=file=>({url:'https://r2.thesportsdb.com/'+file,sourceUrl:'https://www.thesportsdb.com/team/1',attribution:'Club',basis:'Exact identity',...ownerLogoPermission()});
 const calls=[];const fetcher=async url=>{calls.push(url);return url.endsWith('bad.png')?new Response('no',{status:404}):url.endsWith('html.png')?new Response('<html>bad</html>',{headers:{'content-type':'image/png'}}):new Response(bytes,{headers:{'content-type':'image/png'}});};
 const list=['bad.png','html.png','good.png'].map(candidate),result=await resolveBadgeCandidates(store,list,fetcher);assert.equal(result.attempts.length,2);assert.ok(result.media.contentHash);assert.equal((await store.one("SELECT COUNT(*) n FROM media_url_checks WHERE state='failed'")).n,2);
 await resolveBadgeCandidates(store,list,fetcher);assert.equal(calls.length,3);assert.equal((await resolveBadgeCandidates(store,[{...candidate('other.png'),permissionEvidence:null}],fetcher)).media,null);
 }finally{sqlite.close();}
});

test('authorized provider team and competition image candidates enter the same enrichment lifecycle',async()=>{
 const {store,sqlite}=database();try{await store.init();const bytes=await pixels();
 const {liveScoreLogoCandidate,liveScoreCompetitionLogoCandidate}=await import('../../lib/football/logo-discovery.mjs');
 for(const [kind,id] of [['team','601'],['competition','602']]){
  const candidate=kind==='team'?liveScoreLogoCandidate({ID:id,Nm:'Club Women',Img:'teambadge/club.png',Gd:2,Spid:1},'700'):liveScoreCompetitionLogoCandidate({Sid:id,Snm:'Cup Women',badgeUrl:'cup.png'},'700');
  const entity={id:'livescore:'+id,provider:'livescore',externalId:id,name:candidate.entityName,logoCandidate:candidate};
  await store.upsert(kind==='team'?'football_teams':'competitions',{id:entity.id,provider:entity.provider,external_id:id,name:entity.name,country_id:null,...(kind==='competition'?{type:'cup'}:{}),payload:JSON.stringify(entity),updated_at:store.now()});
 }
 await store.run("INSERT INTO media_enrichment VALUES(?,?,?,?,?,?)",'livescore:601','team','skipped',1,store.now()+30*86400000,'{}');
 const result=await enrichMedia({store,env:{},http:{fetcher:async()=>new Response(bytes,{headers:{'content-type':'image/png'}}),json:async()=>{throw Error('Unexpected remote discovery');}}},{visualsOnly:true});
 assert.equal(result.inserted,2);const catalog=await visualCatalog(store);assert.equal(catalog.team['livescore:601'].sourceEntityId,'livescore:601');assert.equal(catalog.competition['livescore:602'].sourceEntityId,'livescore:602');
 }finally{sqlite.close();}
});
