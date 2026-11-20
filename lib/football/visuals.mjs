import {safeLogoImage} from './media-policy.mjs';
export function logoPermission(m){
 const commons=/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(m?.sourceUrl??'')&&/^(CC BY(?:-SA)? (?:[1-4]\.0|2\.5)|CC0(?: 1\.0)?|Public domain)$/i.test(m?.usageBasis??m?.licenseOrPermission??'');
 return Boolean(m?.attribution&&(commons||(m?.publicDisplayAllowed===true&&m?.permissionEvidence&&m?.sourceUrl?.startsWith('https://'))));
}
export function visualInitials(name){const words=String(name??'').normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[];return (words.length===1?Array.from(words[0]).slice(0,3).join(''):words.slice(0,3).map(w=>Array.from(w)[0]).join('')).toLocaleUpperCase()||'FC';}
export function resolveVisual(entity,kind,catalog={}){
 const item=entity.id?catalog[kind]?.[entity.id]:null;
 const real=item?.verified===true&&safeLogoImage(item.logoUrl,item)&&item.licenseOrPermission&&logoPermission(item)&&item.lastCheckedAt;
 return {entityId:entity.id??null,name:entity.name??'',kind,initials:visualInitials(entity.name),logoUrl:real?item.logoUrl:null,source:real?item.source:'Mnemba',sourceEntityId:real?item.sourceEntityId:null,sourceUrl:real?item.sourceUrl:null,licenseOrPermission:real?item.licenseOrPermission:null,attribution:real?item.attribution:null,lastCheckedAt:real?item.lastCheckedAt:null,verified:!!real};
}
export const resolveTeamLogo=(team,catalog)=>resolveVisual(team,'team',catalog);
export const resolveCompetitionLogo=(competition,catalog)=>resolveVisual(competition,'competition',catalog);
// Read only the existing registry: no network lookups, name matching or raw provider logos.
export async function visualCatalog(store){
 const rows=await store.all("SELECT e.entity_id,e.entity_type,a.payload,a.url,a.last_success FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE e.entity_type IN ('team','competition') AND e.media_type='badge' AND a.state='verified' AND a.last_success IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_url_checks c WHERE c.url=a.url AND c.state='failed' AND c.checked_at>=a.last_success) ORDER BY e.is_primary DESC,a.verified_at DESC");
 const result={team:{},competition:{}};
 for(const r of rows){const m=JSON.parse(r.payload);if(result[r.entity_type][r.entity_id]||!safeLogoImage(r.url,m)||!m.usageBasis||!logoPermission(m))continue;result[r.entity_type][r.entity_id]={logoUrl:r.url,source:new URL(m.sourceUrl).hostname,sourceEntityId:m.sourceEntityId??m.providerId??r.entity_id,contentHash:m.contentHash,width:m.width,height:m.height,contentType:m.contentType,sourceUrl:m.sourceUrl,licenseUrl:m.licenseUrl??m.sourceUrl,licenseOrPermission:m.usageBasis,attribution:m.attribution,publicDisplayAllowed:m.publicDisplayAllowed??false,permissionEvidence:m.permissionEvidence??null,verified:true,lastCheckedAt:r.last_success};}
 const aliases=await store.all("SELECT a.provider_id,a.canonical_id,c.kind FROM entity_aliases a JOIN canonical_entities c ON c.id=a.canonical_id WHERE a.verified=1 AND c.kind IN ('team','competition')"),groups=new Map();
 for(const a of aliases){const group=groups.get(a.kind+':'+a.canonical_id)??[];group.push(a.provider_id);groups.set(a.kind+':'+a.canonical_id,group);}
 // Resolve against original direct mappings to avoid chaining inferred identities.
 for(const kind of ['team','competition']){const direct={...result[kind]},owners=new Map();for(const a of aliases.filter(a=>a.kind===kind)){const ids=owners.get(a.provider_id)??new Set();ids.add(a.canonical_id);owners.set(a.provider_id,ids);}for(const [group,allIds] of groups){if(!group.startsWith(kind+':'))continue;const canonicalId=group.slice(kind.length+1),ids=allIds.filter(id=>owners.get(id)?.size===1),candidates=[canonicalId,...ids].filter(id=>direct[id]);if(!candidates.length)continue;const urls=new Set(candidates.map(id=>direct[id].logoUrl));if(urls.size!==1)continue;for(const id of [canonicalId,...ids])if(!result[kind][id])result[kind][id]=direct[candidates[0]];}}
 return result;
}
export async function visualAudit(store){const catalog=await visualCatalog(store),out={at:store.now()};for(const [kind,table] of [['team','football_teams'],['competition','competitions']]){const rows=await store.all(`SELECT id,name FROM ${table}`),real=rows.filter(r=>resolveVisual(r,kind,catalog).verified).length;out[kind]={total:rows.length,real,fallback:rows.length-real,unresolvedRealLogo:rows.length-real,unresolvedVisuals:0};}return out;}
const catalogs=new WeakMap();
export function cachedVisualCatalog(store){const old=catalogs.get(store.db);if(old&&old.until>store.now())return old.value;const value=visualCatalog(store);catalogs.set(store.db,{until:store.now()+60000,value});value.catch(()=>catalogs.delete(store.db));return value;}
export function fixtureTeamVisual(team,fixture){
 const name=typeof team==='string'?team:team?.name??'Team',hasId=typeof team==='object'&&team?.id!=null;
 const candidates=[fixture.home,fixture.away].filter(t=>t&&(hasId?((String(team.id)===t.id||(t.externalId!=null&&String(team.id)===String(t.externalId)))&&(!team.name||team.name===t.name)):t.name===name));
 return {id:candidates.length===1?candidates[0].id:undefined,name:candidates.length===1?candidates[0].name:name};
}
