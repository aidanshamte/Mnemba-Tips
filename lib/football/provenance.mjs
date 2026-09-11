import {digest} from './http.mjs';
import {sourceById} from './source-registry.mjs';
export const normalizedName=name=>String(name).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export class EvidenceStore {
 constructor(store){this.store=store;}
 async entity(kind,providerId,name,sourceId,metadata={}){
  const s=this.store,provider=providerId.split(':')[0],alias=await s.one('SELECT canonical_id FROM entity_aliases WHERE provider=? AND provider_id=?',provider,providerId);
  if(alias)return alias.canonical_id;
  const qid=/^Q\d+$/.test(metadata.wikidataId??'')?metadata.wikidataId:null;
  let id=qid?`wd:${qid}`:`entity:${await digest([kind,providerId])}`;
  if(qid){const found=await s.one('SELECT id FROM canonical_entities WHERE wikidata_id=?',qid);if(found)id=found.id;}
  await s.batch([
   ['INSERT OR IGNORE INTO canonical_entities(id,kind,name,wikidata_id,country,gender,payload,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,kind,name,qid,metadata.country??null,metadata.gender??null,JSON.stringify(metadata),s.now()],
   ['INSERT OR IGNORE INTO entity_aliases(id,canonical_id,provider,provider_id,alias,normalized_alias,verified,source_url) VALUES(?,?,?,?,?,?,?,?)',await digest([provider,providerId]),id,provider,providerId,name,normalizedName(name),Number(!!qid||metadata.verified===true),metadata.sourceUrl??sourceById(sourceId)?.baseUrl??''],
  ]);
  return id;
 }
 async reconcileAlias(providerId,canonicalId,evidenceUrl){
  if(!/^https:\/\//.test(evidenceUrl))throw new Error('A verifiable source URL is required');
  const s=this.store,canonical=await s.one('SELECT id FROM canonical_entities WHERE id=?',canonicalId);if(!canonical)throw new Error('Unknown canonical entity');
  const old=await s.one('SELECT canonical_id FROM entity_aliases WHERE provider_id=?',providerId);
  await s.run('UPDATE entity_aliases SET canonical_id=?,verified=1,source_url=? WHERE provider_id=?',canonicalId,evidenceUrl,providerId);
  if(old&&old.canonical_id!==canonicalId)for(const column of ['home_canonical','away_canonical','competition_canonical'])await s.run(`UPDATE fixture_identities SET ${column}=? WHERE ${column}=?`,canonicalId,old.canonical_id);
 }
 async claims(entityId,kind,sourceId,url,values,meta={}){const plan=await this.prepareClaims(entityId,kind,sourceId,url,values,meta);await this.store.batch(plan.statements);return plan.ids;}
 async prepareClaims(entityId,kind,sourceId,url,values,meta={}){
  const source=sourceById(sourceId);if(!source||source.storageAllowed!==true)throw new Error('Source storage is not permitted');
  const s=this.store,now=s.now(),retrieved=meta.retrievedAt??now;
  if(retrieved>now||!Number.isFinite(retrieved))throw new Error('Invalid retrieved timestamp');
  const published=meta.publishedAt??null;
  if(published!==null&&(!Number.isFinite(published)||published>retrieved))throw new Error('Published time cannot be in the future');
  const existing=await s.all('SELECT * FROM field_claims WHERE entity_id=? AND source_id=? AND valid_to IS NULL',entityId,sourceId);
  const statements=[],ids=[];
  for(const [field,value] of Object.entries(values)){
   if(value===undefined)continue;
   const valueJson=JSON.stringify(value),old=existing.find(c=>c.field===field),expiry=now+(meta.expiresIn??source.refreshMs),retention=now+source.retentionMs;
   if(old?.value_json===valueJson&&old.source_url===url){ids.push(old.id);statements.push(['UPDATE field_claims SET last_seen_at=?,expires_at=?,retain_until=? WHERE id=?',now,expiry,retention,old.id]);continue;}
   const id=await digest([entityId,field,sourceId,url,valueJson,retrieved]);ids.push(id);
   if(old)statements.push(['UPDATE field_claims SET valid_to=? WHERE id=?',retrieved,old.id]);
   statements.push(['INSERT OR IGNORE INTO field_claims(id,entity_id,entity_kind,field,source_id,source_url,post_id,value_json,retrieved_at,last_seen_at,published_at,known_at,confidence,verification,license_ref,expires_at,retain_until,training_allowed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,entityId,kind,field,sourceId,url,meta.postId??null,valueJson,retrieved,now,published,retrieved,meta.confidence??0.85,meta.verification??'sourced',source.licenseUrl,expiry,retention,Number(source.trainingAllowed===true)]);
  }
  return {statements,ids};
 }
 async observeFixture(f,sourceUrl=null){
  const s=this.store,sourceId=f.provider,source=sourceById(sourceId);if(!source)return;
  const url=sourceUrl??f.sourceUrl??source.apiUrl??source.baseUrl;
  const home=await this.entity('team',f.home.id,f.home.name,sourceId,{sourceUrl:url,country:f.competition.country?.name,gender:f.gender??null});
  const away=await this.entity('team',f.away.id,f.away.name,sourceId,{sourceUrl:url,country:f.competition.country?.name,gender:f.gender??null});
  const competition=await this.entity('competition',f.competition.id,f.competition.name,sourceId,{sourceUrl:url,country:f.competition.country?.name,gender:f.gender??null});
  // Reconcile only explicit provider cross-references, never a fuzzy club-name guess.
  if(f.crossReferences?.apiFootballId){const other=await s.one('SELECT * FROM fixture_identities WHERE fixture_id=?',`api-football:${f.crossReferences.apiFootballId}`);if(other){await this.reconcileAlias(f.home.id,other.home_canonical,url);await this.reconcileAlias(f.away.id,other.away_canonical,url);await this.reconcileAlias(f.competition.id,other.competition_canonical,url);}}
  const ids=await s.all('SELECT provider_id,canonical_id FROM entity_aliases WHERE provider_id IN (?,?,?)',f.home.id,f.away.id,f.competition.id);
  const mapped=id=>ids.find(a=>a.provider_id===id)?.canonical_id;
  let canonical=`fixture:${await digest([mapped(f.home.id)??home,mapped(f.away.id)??away,mapped(f.competition.id)??competition,new Date(f.startsAt).toISOString().slice(0,10)])}`;
  const prior=await s.one('SELECT canonical_id,verification FROM fixture_identities WHERE fixture_id=?',f.id);if(prior)canonical=prior.canonical_id;
  if(f.crossReferences?.apiFootballId){const other=await s.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?',`api-football:${f.crossReferences.apiFootballId}`);if(other)canonical=other.canonical_id;}
  await s.run('INSERT INTO fixture_identities(fixture_id,canonical_id,home_canonical,away_canonical,competition_canonical,verification) VALUES(?,?,?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET canonical_id=excluded.canonical_id,home_canonical=excluded.home_canonical,away_canonical=excluded.away_canonical,competition_canonical=excluded.competition_canonical,verification=excluded.verification',f.id,canonical,mapped(f.home.id)??home,mapped(f.away.id)??away,mapped(f.competition.id)??competition,prior?.verification==='verified-reference'?'verified-reference':f.crossReferences?'provider-reference':'provider-scoped');
  await this.claims(f.id,'fixture',sourceId,url,{fixture:f,startsAt:f.startsAt,status:f.status,homeScore:f.homeScore,awayScore:f.awayScore,venue:f.venue??null},{publishedAt:f.publishedAt??null,confidence:sourceId==='thesportsdb'?0.8:0.95,expiresIn:['FT','FINISHED','AET','PEN'].includes(f.status)?3650*86400000:1800000});
  await this.conflicts(canonical);
 }
 async conflicts(canonicalId){
  const rows=await this.store.all('SELECT c.* FROM field_claims c JOIN fixture_identities f ON f.fixture_id=c.entity_id WHERE f.canonical_id=? AND c.valid_to IS NULL AND c.field IN (\'startsAt\',\'status\',\'homeScore\',\'awayScore\')',canonicalId);
  for(const field of [...new Set(rows.map(c=>c.field))]){
   const claims=rows.filter(c=>c.field===field&&c.value_json!=='null'),id=await digest([canonicalId,field]);
   if(new Set(claims.map(c=>`${c.source_id}|${c.source_url}`)).size>1&&new Set(claims.map(c=>c.value_json)).size>1)await this.store.upsert('evidence_conflicts',{id,entity_id:canonicalId,field,claims:JSON.stringify(claims.map(c=>c.id)),status:'open',detected_at:this.store.now(),resolved_at:null});
   else await this.store.run("UPDATE evidence_conflicts SET status='resolved',resolved_at=? WHERE id=?",this.store.now(),id);
  }
 }
 async asOf(entityId,cutoff,training=false){return this.store.all(`SELECT * FROM field_claims WHERE entity_id=? AND known_at<=? AND (published_at IS NULL OR published_at<=?) AND (valid_to IS NULL OR valid_to>?) AND expires_at>? ${training?'AND training_allowed=1':''} ORDER BY field,source_id`,entityId,cutoff,cutoff,cutoff,cutoff);}
 async queue(kind,entityId,url,payload){const id=await digest([kind,entityId,url,payload]);await this.store.run('INSERT OR IGNORE INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES(?,?,?,?,?,?,?)',id,kind,entityId,url,JSON.stringify(payload),'pending',this.store.now());return id;}
 async retention(){
  const now=this.store.now();
  // Snapshots keep evidence IDs and numeric features, not copied article/social text.
  await this.store.batch([['DELETE FROM http_response_cache WHERE retain_until<?',now],['DELETE FROM social_evidence WHERE expires_at<?',now],['DELETE FROM field_claims WHERE retain_until<?',now],['DELETE FROM news_articles WHERE updated_at<?',now-7*86400000]]);
 }
}
