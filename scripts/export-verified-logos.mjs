import {writeFileSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {visualCatalog} from '../lib/football/visuals.mjs';
import {downloadLogo} from '../lib/football/image-validation.mjs';
const output=process.argv[2];if(!output)throw Error('Output manifest path required');
const filter=new Set(process.argv.slice(3)),{store,sqlite}=database(populatedLocalDatabase());
const entries=[],failures=[],downloads=new Map();
try{
 const catalog=await visualCatalog(store);
 for(const [type,table] of [['team','football_teams'],['competition','competitions']])for(const entity of await store.all(`SELECT id,name FROM ${table}`)){
  if(filter.size&&!filter.has(entity.id))continue;
  const visual=catalog[type][entity.id];if(!visual)continue;
  let checkedUrl;
  try{
   const row=await store.one('SELECT payload FROM media_assets WHERE url=?',visual.logoUrl),media=JSON.parse(row.payload);
   checkedUrl=media.url;
   let check=downloads.get(media.url);if(!check){check=downloadLogo(media.url);downloads.set(media.url,check);}
   const {metadata}=await check;
   // Changed bytes require renewed visual review rather than silently replacing artwork.
   if(media.contentHash&&metadata.contentHash!==media.contentHash)throw Error('Source image changed since review');
   const link=await store.one("SELECT identity_basis FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE e.entity_id=? AND a.url=? AND e.media_type='badge'",entity.id,media.url);
   if(!link?.identity_basis)throw Error('Direct identity evidence required for transfer');
   entries.push({entity:{...entity,type},media:{...media,...metadata,lastSuccess:store.now()},basis:link.identity_basis});
  }catch(error){failures.push({id:entity.id,name:entity.name,url:checkedUrl,error:error.message});if(checkedUrl)await store.run('INSERT INTO media_url_checks VALUES(?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,retry_at=excluded.retry_at,payload=excluded.payload',checkedUrl,'failed',store.now(),store.now()+86400000,JSON.stringify({error:error.message}));}
  writeFileSync(output,JSON.stringify({at:Date.now(),entries,failures},null,2));
 }
 console.log(JSON.stringify({entries:entries.length,failures}));
}finally{sqlite.close();}
