import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {downloadLogo} from '../lib/football/image-validation.mjs';
import {saveMedia} from '../lib/football/media-registry.mjs';
import {visualCompetitionContext} from '../lib/football/logo-discovery.mjs';
import {visualCatalog} from '../lib/football/visuals.mjs';
const permission=JSON.parse(readFileSync('config/logo-permission.json','utf8'));
const {store:s,sqlite}=database(populatedLocalDatabase());
const root='.sites-runtime/real-logos';mkdirSync(root,{recursive:true});
try{
 sqlite.exec('PRAGMA busy_timeout=10000');
 const candidates=await s.all("SELECT e.entity_id,e.entity_type,e.identity_basis,a.payload FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE e.media_type='badge' AND e.entity_type IN ('team','competition') ORDER BY e.entity_id");
 const results=[],downloads=new Map();
 if(process.argv.includes('--enrich')){
  const backup=root+'/before-enrichment-'+Date.now()+'.sqlite';sqlite.prepare('VACUUM INTO ?').run(backup);
  const owner=await s.lock('football-sync',300000);if(!owner)throw Error('Another update is running');
  try{for(const c of candidates){const m=JSON.parse(c.payload);try{
   let check=downloads.get(m.url);if(!check){check=downloadLogo(m.url);downloads.set(m.url,check);}const {metadata}=await check;
   await saveMedia(s,{id:c.entity_id,type:c.entity_type},'badge',{...m,...metadata,publicDisplayAllowed:true,permissionEvidence:permission.reference,usageBasis:'Project-owner permission: '+permission.reference,lastSuccess:s.now()},c.identity_basis);
   results.push({id:c.entity_id,state:'valid',url:m.url,...metadata});
  }catch(e){results.push({id:c.entity_id,state:'broken',url:m.url,error:e.message});}}
  }finally{await s.unlock('football-sync',owner);}
  writeFileSync(root+'/validation.json',JSON.stringify(results,null,2));
 }
 const discoveryFiles=['discovery-Tanzania.json','wiki-discovery.json','openliga-discovery.json','reviewed-import.json','catalogue-discovery.json','team-discovery.json','verified-identity-links.json','stored-provider-import.json','apwin-discovery.json','league-discovery.json'];const discovery=discoveryFiles.filter(f=>existsSync(root+'/'+f)).flatMap(f=>JSON.parse(readFileSync(root+'/'+f)));
 const failedImages=await s.all("SELECT e.entity_id,c.payload,c.checked_at FROM entity_media e JOIN media_assets a ON a.id=e.asset_id JOIN media_url_checks c ON c.url=a.url WHERE c.state='failed' AND c.checked_at>=a.last_success");
 const catalog=await visualCatalog(s),aliases=await s.all("SELECT a.provider_id,a.canonical_id,c.kind FROM entity_aliases a JOIN canonical_entities c ON c.id=a.canonical_id WHERE a.verified=1"),attempts=new Map(results.map(r=>[r.id,r]));
 const membership=new Map(),competitionContexts=new Map();for(const f of await s.all('SELECT payload FROM fixtures')){const p=JSON.parse(f.payload),context=visualCompetitionContext(p.competition,p.sourceUrl);if(context?.country?.name)competitionContexts.set(context.id,context);for(const t of [p.home,p.away])if(t?.id){const a=membership.get(t.id)??[];a.push(visualCompetitionContext(p.competition,p.sourceUrl));membership.set(t.id,a);}}
 const output={at:new Date().toISOString(),scope:'All persisted team/competition identities; verified canonical aliases coalesced, unmapped records remain separate. No entities hidden to improve coverage.',teams:[],competitions:[]};
 for(const [kind,table,key] of [['team','football_teams','teams'],['competition','competitions','competitions']]){
  const groups=new Map();for(const r of await s.all(`SELECT id,name,payload FROM ${table} ORDER BY id`)){
   const matches=[...new Set(aliases.filter(a=>a.kind===kind&&a.provider_id===r.id).map(a=>a.canonical_id))],id=matches.length===1?matches[0]:r.id;
   const group=groups.get(id)??{id,name:r.name,providerIds:[],competitionIds:[],countries:[],regions:[],state:'missing',blocker:'No identity-verified image candidate available in current registry; cross-source identity discovery required'};
   if(/^(?:3rd Group|Runner-up Group|Winner Group|Winner Match)\b/.test(r.name)){group.state='blocked';group.blocker='Unresolved tournament participant slot, not an identified team. Requires verified participant assignment before any real crest can be selected.';}
   if(/\babd\.\s+.*\[abandoned|^in \d+['\]]/.test(r.name)){group.state='blocked';group.blocker='Stored name contains an abandoned-match parser fragment rather than one verified team identity; requires source identity correction, not a guessed crest.';}
   group.providerIds.push(r.id);const p=JSON.parse(r.payload),competitions=kind==='competition'?[competitionContexts.get(r.id)??p]:membership.get(r.id)??[];
   for(const c of competitions){if(c?.id)group.competitionIds.push(c.id);if(c?.country?.name)group.countries.push(c.country.name);const region=c?.country?.continent??({UEFA:'Europe',CAF:'Africa',AFC:'Asia',CONCACAF:'North America',CONMEBOL:'South America',OFC:'Oceania'})[c?.confederation]??(['Africa','Europe','Asia','Oceania'].includes(c?.country?.name)?c.country.name:null);if(region)group.regions.push(region);}
   const visual=catalog[kind][r.id];if(matches.length>1){group.state='ambiguous';group.blocker='Conflicting verified canonical mappings';}
   else if(visual&&group.state!=='ambiguous'){const asset=await s.one('SELECT payload FROM media_assets WHERE url=?',visual.logoUrl);const media=JSON.parse(asset?.payload??'{}');if(media.contentHash&&media.width>=32&&media.height>=32){group.state='valid';group.blocker=null;group.url=visual.logoUrl;group.contentHash=media.contentHash;group.lastCheckedAt=media.lastSuccess;}}
   const browserFailure=failedImages.find(f=>f.entity_id===r.id);if(browserFailure&&group.state!=='valid'){group.state='broken';group.blocker=JSON.parse(browserFailure.payload).error??'Recorded image load failure';}
   const attempt=attempts.get(r.id);if(attempt?.state==='broken'&&group.state!=='valid'){group.state='broken';group.blocker=attempt.error;}
   groups.set(id,group);
  }
  output[key]=[...groups.values()].map(g=>({...g,attempts:discovery.filter(d=>g.providerIds.includes(d.id??d.entityId)).map(d=>({sourceUrl:d.sourceUrl??d.attempts?.[0]?.source,state:d.state,error:d.error??null})),competitionIds:[...new Set(g.competitionIds)],countries:[...new Set(g.countries)],regions:[...new Set(g.regions)]}));
 }
 const summarize=rows=>({total:rows.length,real:rows.filter(r=>r.state==='valid').length,missing:rows.filter(r=>r.state==='missing'||r.state==='blocked').length,blocked:rows.filter(r=>r.state==='blocked').length,broken:rows.filter(r=>r.state==='broken').length,ambiguous:rows.filter(r=>r.state==='ambiguous').length,fallback:rows.filter(r=>r.state!=='valid').length,coverage:rows.length?100*rows.filter(r=>r.state==='valid').length/rows.length:0});
 output.summary={teams:summarize(output.teams),competitions:summarize(output.competitions)};
 output.regions={};for(const region of ['Africa','Europe','Asia','Americas','Oceania','Unclassified']){const filter=r=>region==='Unclassified'?!r.regions.length:r.regions.includes(region)||region==='Americas'&&r.regions.some(v=>/America/.test(v));output.regions[region]={teams:summarize(output.teams.filter(filter)),competitions:summarize(output.competitions.filter(filter))};}
 output.tanzania={teams:summarize(output.teams.filter(r=>r.countries.includes('Tanzania'))),competitions:summarize(output.competitions.filter(r=>r.countries.includes('Tanzania')))};
 output.validatedAssets=new Set((await s.all("SELECT payload FROM media_assets WHERE state='verified'")).map(r=>JSON.parse(r.payload)).filter(m=>m.contentHash&&m.permissionEvidence===permission.reference).map(m=>m.contentHash)).size;
 output.status=[...output.teams,...output.competitions].every(r=>r.state==='valid')?'DATABASE_VALIDATED_BROWSER_PENDING':'INCOMPLETE';
 writeFileSync(root+'/coverage.json',JSON.stringify(output,null,2));console.log(JSON.stringify({status:output.status,...output.summary,tanzania:output.tanzania,validatedAssets:output.validatedAssets},null,2));
}finally{sqlite.close();}
