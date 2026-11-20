import {writeFileSync,mkdirSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {visualAudit} from '../lib/football/visuals.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {enrichMedia} from '../lib/football/media-registry.mjs';
const {store,sqlite}=database(populatedLocalDatabase());
try{sqlite.exec('PRAGMA busy_timeout=10000');const before=await visualAudit(store);let enrichment=null;if(process.argv.includes('--enrich')){const service=new IntelligenceService(store,{MNEMBA_MEDIA_BATCH_SIZE:'32'});await service.initialize();const owner=await store.lock('football-sync',300000);if(!owner)throw Error('Another update is running');try{await store.run("UPDATE media_enrichment SET next_attempt=-2 WHERE entity_type IN ('team','competition') AND (entity_id IN (SELECT id FROM football_teams WHERE json_extract(payload,'$.wikidataId') IS NOT NULL) OR entity_id IN (SELECT id FROM competitions WHERE json_extract(payload,'$.wikidataId') IS NOT NULL))");enrichment=await enrichMedia(service,{visualsOnly:true});}finally{await store.unlock('football-sync',owner);}}const after=await visualAudit(store);mkdirSync('.sites-runtime/visual-identities',{recursive:true});writeFileSync('.sites-runtime/visual-identities/audit.json',JSON.stringify({before,enrichment,after},null,2));console.log(JSON.stringify({before,enrichment,after},null,2));}finally{sqlite.close();}
