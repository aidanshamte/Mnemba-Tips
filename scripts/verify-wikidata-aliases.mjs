// Explicitly reviewed mapping import; never fuzzy-merges similarly named clubs.
import {readdirSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {searchText,refreshSearchIndex} from '../lib/football/search.mjs';
import {digest} from '../lib/football/http.mjs';
const [providerId,qid,country]=process.argv.slice(2);if(!providerId||!/^Q\d+$/.test(qid??'')||!/^Q\d+$/.test(country??''))throw Error('Usage: node scripts/verify-wikidata-aliases.mjs <provider-team-id> <reviewed-Wikidata-ID> <country-QID>');
const root='.wrangler/state/v3/d1/miniflare-D1DatabaseObject',path=readdirSync(root).find(p=>p.endsWith('.sqlite')&&p!=='metadata.sqlite'),{store,sqlite}=database(`${root}/${path}`);await store.init();const service=new IntelligenceService(store);await service.initialize();
const owner=await store.lock('football-sync',120000);if(!owner)throw Error('Synchronization busy');
try{const row=await store.one('SELECT payload FROM football_teams WHERE id=?',providerId);if(!row)throw Error('Unknown team');const team=JSON.parse(row.payload),[entity]=await service.wiki.entities([qid]);if(!entity||entity.country!==country)throw Error('Country identity mismatch');const names=[entity.name,...entity.aliases];if(!names.some(n=>searchText(n)===searchText(team.name)))throw Error('Exact retrieved name/alias correspondence required');
 const canonical=await service.evidence.entity('team',`wikidata:${qid}`,entity.name,'wikidata',{...entity,wikidataId:qid});await service.evidence.claims(canonical,'team','wikidata',entity.sourceUrl,entity);await service.evidence.reconcileAlias(providerId,canonical,entity.sourceUrl);await service.social.registerFromWikidata(canonical,entity);
 for(const alias of new Set(names))await store.upsert('verified_entity_aliases',{id:await digest([providerId,searchText(alias)]),provider_id:providerId,alias,normalized_alias:searchText(alias),source_url:entity.sourceUrl,license_ref:'https://www.wikidata.org/wiki/Wikidata:Licensing',verified_at:store.now()});
 const places=await service.wiki.entities([country,entity.stadium].filter(Boolean));await service.saveTeam({...team,aliases:names,wikidataId:qid,country:places.find(p=>p.id===country)?.name??team.country,stadium:places.find(p=>p.id===entity.stadium)?.name??team.stadium,website:entity.website??team.website,stadiumId:entity.stadium,identitySourceUrl:entity.sourceUrl});await store.run("DELETE FROM football_cache WHERE id='search-index'");console.log(JSON.stringify({team:team.name,qid,aliases:names,canonical,index:await refreshSearchIndex(store,true)}));
}finally{await store.unlock('football-sync',owner);sqlite.close();}
