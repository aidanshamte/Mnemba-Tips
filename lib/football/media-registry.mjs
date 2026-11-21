import {logoPermission} from './visuals.mjs';
import {safeImage,safeLogoImage} from './media-policy.mjs';
import {cleanText} from './news.mjs';
import {digest} from './digest.mjs';
import {ownerLogoPermission} from './logo-permission.mjs';

// ESM import() needs a URL, not a raw filesystem path. Windows
// drive paths (C: plus backslashes) are rejected as an unknown "c:" scheme. Build a file:// URL with
// pathToFileURL (handles drive letters, separators and spaces). Node built-ins are
// loaded lazily so UI/edge bundles that share this module never resolve them.
export async function decoderModuleUrl(cwd=process.cwd(),windows=process.platform==='win32'){
 const [{pathToFileURL},path]=await Promise.all([import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:url'),import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:path')]);
 const join=windows?path.win32.join:path.posix.join;
 return pathToFileURL(join(cwd,'lib','football','image-validation.mjs'),{windows}).href;
}

// Badge validation shares the byte decoder used by offline discovery. The
// existing check table retains per-candidate failure/backoff and decoded data.
export async function validateBadgeCandidate(s, candidate, fetcher=fetch){
 if(!logoPermission(candidate))throw Error('Logo permission/provenance required');
 if(!safeLogoImage(candidate.url,{...candidate,contentHash:'0'.repeat(64),width:32,height:32}))throw Error('Rejected logo host');
 const previous=await s.one('SELECT * FROM media_url_checks WHERE url=?',candidate.url);
 if(previous?.retry_at>s.now()){
  if(previous.state!=='ok')throw Error('Failed URL backoff');
  const cached=JSON.parse(previous.payload);
  if(cached.contentHash&&cached.width>=32&&cached.height>=32)return {...candidate,...cached,lastSuccess:previous.checked_at};
 }
 try{
  // Some UI utilities share this module transitively. Keep the native decoder
  // in the Node background runtime; Azure ships lib/ alongside the application.
  const {downloadLogo}=await import(/* webpackIgnore: true */ /* @vite-ignore */ await decoderModuleUrl());
  const {metadata}=await downloadLogo(candidate.url,fetcher);
  await s.run('INSERT INTO media_url_checks VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,retry_at=excluded.retry_at,payload=excluded.payload',candidate.url,'ok',s.now(),s.now()+7*86400000,JSON.stringify(metadata));
  return {...candidate,...metadata,lastSuccess:s.now()};
 }catch(error){
  await s.run('INSERT INTO media_url_checks VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,retry_at=excluded.retry_at,payload=excluded.payload',candidate.url,'failed',s.now(),s.now()+86400000,JSON.stringify({error:error.message}));
  throw error;
 }
}

export async function resolveBadgeCandidates(s,candidates,fetcher=fetch){
 const attempts=[];
 for(const candidate of candidates.flatMap(c=>[c,...(c.alternateUrls??[]).map(url=>({...c,url}))])){try{return {media:await validateBadgeCandidate(s,candidate,fetcher),basis:candidate.basis,attempts};}catch(error){attempts.push({url:candidate.url,error:error.message});}}
 return {media:null,attempts};
}
export async function mediaFor(s,ids){
 if(!ids.length)return{};const out={};
 for(const id of [...new Set(ids)]){
  const aliases=await s.all("SELECT b.provider_id FROM entity_aliases a JOIN entity_aliases b ON b.canonical_id=a.canonical_id WHERE a.provider_id=? AND a.verified=1 AND b.verified=1",id),linked=[...new Set([id,...aliases.map(a=>a.provider_id)])];
  const rows=await s.all(`SELECT e.entity_id,e.entity_type,e.media_type,a.payload FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE e.entity_id IN (${linked.map(()=>'?').join(',')}) AND a.state='verified' AND a.last_success IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_url_checks c WHERE c.url=a.url AND c.state='failed' AND c.checked_at>=a.last_success) ORDER BY CASE WHEN e.entity_id=? THEN 0 ELSE 1 END,e.is_primary DESC,a.verified_at DESC`,...linked,id);
  const r=rows[0];if(r)out[id]={...JSON.parse(r.payload),entityId:r.entity_id,resolvedFor:id,entityType:r.entity_type,type:r.media_type};
 }return out;
}
export async function saveMedia(s,entity,type,m,basis){
 if(!(type==='badge'?safeLogoImage(m.url,m):safeImage(m.url))||!['team','player','competition','publisher'].includes(entity.type)||!['badge','portrait','action','thumbnail','video'].includes(type)||!entity.id||!basis||!m.usageBasis||!m.attribution||!m.sourceUrl?.startsWith('https://')||!Number.isFinite(m.lastSuccess))throw Error('Verified load, identity and media provenance required');
 const id=await digest(m.url),payload={...m,verifiedAt:s.now()};await s.upsert('media_assets',{id,url:m.url,source_url:m.sourceUrl,usage_basis:m.usageBasis,attribution:m.attribution,verified_at:s.now(),last_success:m.lastSuccess,width:m.width??null,height:m.height??null,state:'verified',payload:JSON.stringify(payload)});
 await s.run('INSERT OR IGNORE INTO entity_media VALUES(?,?,?,?,?,?)',entity.id,entity.type,type,id,1,basis);
}
export function commonsImageUrl(raw){try{const u=new URL(raw);if(!['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname))return null;for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);return safeImage(u.href);}catch{return null;}}
export function commonsMetadata(info){const e=info?.extmetadata??{},license=cleanText(e.LicenseShortName?.value),creator=cleanText(e.Artist?.value),url=commonsImageUrl(info?.thumburl??info?.url);if(!/^(CC BY(?:-SA)? (?:[1-4]\.0|2\.5)|CC0(?: 1\.0)?|Public domain)$/i.test(license)||!creator||!info.descriptionurl?.startsWith('https://commons.wikimedia.org/wiki/File:')||!url)return null;const licenseUrl=e.LicenseUrl?.value;return{url,sourceUrl:info.descriptionurl,usageBasis:license,licenseUrl:licenseUrl?.startsWith('https://creativecommons.org/')?licenseUrl:info.descriptionurl,attribution:creator,width:info.thumbwidth??info.width,height:info.thumbheight??info.height,originalUrl:commonsImageUrl(info.url)};}
export async function checkMediaUrl(s,url,fetcher=fetch){if(!safeImage(url))throw Error('Rejected image URL');const previous=await s.one('SELECT * FROM media_url_checks WHERE url=?',url);if(previous&&previous.retry_at>s.now()){if(previous.state!=='ok')throw Error('Failed URL backoff');return previous.checked_at;}
 const hostKey='media-host:'+new URL(url).hostname,host=await s.cache(hostKey);if(host&&!host.stale)throw Error('Media host backoff: '+host.data.status);
 let response;try{response=await fetcher(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});}catch(error){await s.run('INSERT INTO media_url_checks VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,retry_at=excluded.retry_at,payload=excluded.payload',url,'failed',s.now(),s.now()+86400000,JSON.stringify({status:0,error:String(error.message)}));throw error;}const ok=response.ok&&/^image\/(jpeg|png|webp|avif)/i.test(response.headers.get('content-type')??'');await s.run('INSERT INTO media_url_checks VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,retry_at=excluded.retry_at,payload=excluded.payload',url,ok?'ok':'failed',s.now(),s.now()+(ok?7*86400000:86400000),JSON.stringify({status:response.status}));if(!ok){if([403,429].includes(response.status))await s.putCache(hostKey,{status:response.status},86400000);throw Error('Image load/type verification failed: HTTP '+response.status);}return s.now();}
export async function enrichMedia(service,options={}){const errors=[],s=service.store,counts={inserted:0,updated:0,unchanged:0,skipped:0,failed:0};
 // Queue persistent entities. Exact existing Wikidata identities receive priority.
 await s.run("INSERT OR IGNORE INTO media_enrichment SELECT id,'player','pending',0,0,'{}' FROM football_players");
 await s.run("INSERT OR IGNORE INTO media_enrichment SELECT id,'team','pending',0,0,'{}' FROM football_teams");
 await s.run("INSERT OR IGNORE INTO media_enrichment SELECT id,'competition','pending',0,0,'{}' FROM competitions");
 // A later ingestion may supply an image for an identity previously skipped.
 await s.run("UPDATE media_enrichment SET state='pending',next_attempt=0 WHERE state='skipped' AND (entity_id IN (SELECT id FROM football_teams WHERE (provider='livescore' AND json_extract(payload,'$.logoCandidate.sourceEntityId')=id) OR (provider='thesportsdb' AND json_extract(payload,'$.logo') IS NOT NULL)) OR entity_id IN (SELECT id FROM competitions WHERE (provider='livescore' AND json_extract(payload,'$.logoCandidate.sourceEntityId')=id) OR (provider='thesportsdb' AND json_extract(payload,'$.badge') IS NOT NULL)))");
 const badgeCache=await s.cache('public-badges');const known=Object.keys(badgeCache?.data?.badges??{}).filter(id=>logoPermission(badgeCache.data.badges[id]));if(known.length)await s.run(`UPDATE media_enrichment SET state='pending',next_attempt=-1 WHERE state IN ('pending','skipped') AND entity_id IN (${known.map(()=>'?').join(',')})`,...known);
 await s.run("UPDATE media_enrichment SET state='pending',next_attempt=0 WHERE state='skipped' AND json_extract(payload,'$.reason')='Commons license or creator metadata not acceptable' AND json_extract(payload,'$.policyVersion') IS NULL");
 await s.run("UPDATE media_enrichment SET state='pending',next_attempt=0 WHERE state='skipped' AND json_extract(payload,'$.reason')='No verified media identity or permitted source' AND (entity_id IN (SELECT id FROM football_teams WHERE json_extract(payload,'$.wikidataId') IS NOT NULL) OR entity_id IN (SELECT a.provider_id FROM entity_aliases a JOIN entity_aliases b ON b.canonical_id=a.canonical_id WHERE a.verified=1 AND b.verified=1 AND b.provider_id LIKE 'wikidata:%'))");
 const rows=await s.all("SELECT * FROM media_enrichment WHERE next_attempt<=? AND (?=0 OR entity_type IN ('team','competition')) ORDER BY CASE WHEN next_attempt=-1 THEN -1 WHEN EXISTS (SELECT 1 FROM football_players p WHERE p.id=entity_id AND json_extract(p.payload,'$.birthDate') IS NOT NULL AND json_extract(p.payload,'$.description') IS NOT NULL) THEN 0 WHEN next_attempt=-1 THEN 1 WHEN entity_id LIKE 'wikidata:%' THEN 2 ELSE 3 END,next_attempt,entity_id LIMIT ?",s.now(),Number(options.visualsOnly===true),Math.min(50,Math.max(1,Number(service.env?.MNEMBA_MEDIA_BATCH_SIZE)||24)));
 for(const row of rows){let state='skipped',reason='No verified media identity or permitted source';try{
 const table=row.entity_type==='player'?'football_players':row.entity_type==='competition'?'competitions':'football_teams',record=await s.one(`SELECT payload FROM ${table} WHERE id=?`,row.entity_id),entity=JSON.parse(record?.payload??'null');if(!entity)continue;
 let m,type=row.entity_type==='player'?'portrait':'badge',basis;const existingLink=await s.one('SELECT asset_id FROM entity_media WHERE entity_id=? AND media_type=?',row.entity_id,type);
 const badge=badgeCache?.data?.badges?.[row.entity_id];
 const attempts=[];
 if(type==='badge'){
  const existing=await s.all("SELECT a.payload,e.identity_basis FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE e.entity_id=? AND e.media_type='badge' AND a.state='verified' ORDER BY a.last_success DESC",row.entity_id);
  const candidates=existing.map(r=>({...JSON.parse(r.payload),basis:r.identity_basis})).filter(logoPermission);
  if(badge?.verifiedAt&&logoPermission(badge)&&badge.basis)candidates.push(badge);
  if(entity.provider==='livescore'&&entity.logoCandidate?.sourceEntityId===entity.id&&entity.logoCandidate.entityName===entity.name&&/^https:\/\/prod-cdn-public-api\.lsmedia1\.com\/v1\/api\/app\/scoreboard\/soccer\/\d+$/.test(entity.logoCandidate.sourceUrl))candidates.push({...entity.logoCandidate,...ownerLogoPermission()});
  if(entity.provider==='thesportsdb'&&/^thesportsdb:\d+$/.test(entity.id)&&String(entity.externalId)===entity.id.split(':')[1]&&safeImage(entity.logo??entity.badge))candidates.push({url:entity.logo??entity.badge,sourceUrl:'https://www.thesportsdb.com/'+(row.entity_type==='competition'?'league/':'team/')+entity.externalId,sourceEntityId:entity.id,attribution:'TheSportsDB; mark belongs to its owner',...ownerLogoPermission(),basis:'Logo from the same persisted provider identity '+entity.id});
  const resolved=await resolveBadgeCandidates(s,[...new Map(candidates.map(c=>[c.url,c])).values()],service.http.fetcher);m=resolved.media;basis=resolved.basis;attempts.push(...resolved.attempts);
 }

 const aliases=await s.all("SELECT b.provider_id FROM entity_aliases a JOIN entity_aliases b ON b.canonical_id=a.canonical_id JOIN canonical_entities c ON c.id=a.canonical_id WHERE a.provider_id=? AND a.verified=1 AND b.verified=1 AND b.provider_id LIKE 'wikidata:%' AND c.kind=?",row.entity_id,row.entity_type);
 const ids=[...new Set([row.entity_id,...aliases.map(a=>a.provider_id),...(entity.wikidataId&&/^Q\d+$/.test(entity.wikidataId)?['wikidata:'+entity.wikidataId]:[])].filter(id=>/^wikidata:Q\d+$/.test(id)))],qid=ids.length===1?ids[0].split(':')[1]:null;
 if(!m&&qid){reason='Verified identity has no permitted media claim';const result=await service.http.json('wikidata','https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbgetentities',ids:qid,props:'claims',format:'json'}));const claims=result.entities?.[qid]?.claims;const file=claims?.[row.entity_type==='player'?'P18':'P154']?.find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value;
 if(file){const data=await service.http.json('commons-media','https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',titles:'File:'+file,prop:'imageinfo',iiprop:'url|size|extmetadata',iiurlwidth:'320',format:'json'}));m=commonsMetadata(Object.values(data.query?.pages??{})[0]?.imageinfo?.[0]);basis='Exact persisted Wikidata entity '+qid+' media claim';if(!m)reason='Commons license or creator metadata not acceptable';}}
 if(m){if(type==='badge'){if(!m.contentHash)m=await validateBadgeCandidate(s,m,service.http.fetcher);}else m.lastSuccess=await checkMediaUrl(s,m.url);const existing=await s.one('SELECT id,payload FROM media_assets WHERE url=?',m.url);await saveMedia(s,{id:row.entity_id,type:row.entity_type},type,m,basis);const previous=existing?JSON.parse(existing.payload):null;const unchanged=previous&&['url','sourceUrl','usageBasis','attribution','width','height','licenseUrl'].every(k=>previous[k]===m[k]);counts[!existingLink?'inserted':unchanged?'unchanged':'updated']++;state='verified';reason=basis;}else if(attempts.length){state='failed';reason=JSON.stringify(attempts);counts.failed++;errors.push({entity:row.entity_id,attempts});}else counts.skipped++;
 }catch(e){state='failed';reason=e.message;counts.failed++;errors.push({entity:row.entity_id,error:reason});}
 await s.run('UPDATE media_enrichment SET state=?,attempts=?,next_attempt=?,payload=? WHERE entity_id=?',state,row.attempts+1,s.now()+(state==='failed'?Math.min(7,2**Math.min(row.attempts,3)):30)*86400000,JSON.stringify({reason,at:s.now(),policyVersion:2}),row.entity_id);}
 return{...counts,errors,processed:rows.length,remaining:(await s.one("SELECT COUNT(*) n FROM media_enrichment WHERE state='pending'")).n};
}
export async function enrichNewsMedia(service){const s=service.store,rows=await s.all('SELECT payload FROM news_articles ORDER BY published_at DESC'),counts={inserted:0,unchanged:0,skipped:0,failed:0},errors=[];let attempted=0;
 for(const row of rows){const a=JSON.parse(row.payload);for(const m of a.images??[]){if(!m.usageBasis||m.articleUrl!==a.url||!safeImage(m.url)){counts.skipped++;continue;}const existing=await s.one('SELECT state FROM media_assets WHERE url=?',m.url);if(existing?.state==='verified'){counts.unchanged++;continue;}const checked=await s.one('SELECT retry_at FROM media_url_checks WHERE url=?',m.url);if(checked?.retry_at>s.now()){counts.skipped++;continue;}if(attempted>=4)return{...counts,processed:attempted,errors};attempted++;try{const lastSuccess=await checkMediaUrl(s,m.url);await saveMedia(s,{id:'publisher:'+new URL(a.url).hostname,type:'publisher'},'action',{...m,lastSuccess},'Publisher feed associates image with article '+a.url);counts.inserted++;}catch(e){counts.failed++;errors.push({url:m.url,error:e.message});}}}
 return{...counts,processed:attempted,errors};
}
