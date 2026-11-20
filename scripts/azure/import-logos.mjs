// Existing registry/store path, media-only, exact-ID import. Default: dry run.
import {readFileSync,writeFileSync} from 'node:fs';
import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {importVerifiedLogos} from '../../lib/football/media-backfill.mjs';
const input=process.argv[2],apply=process.argv.includes('--apply'),backup=process.argv.find(v=>v.startsWith('--backup='))?.slice(9);
if(!input||apply&&!backup)throw Error('Manifest required; --apply also requires --backup=path for affected media rows');
const {entries}=JSON.parse(readFileSync(input));if(!Array.isArray(entries))throw Error('Invalid media manifest');
const pool=createPool(),client=await pool.connect(),report=[],before={assets:[],links:[]};
try{
 for(let offset=0;offset<entries.length;offset+=50){const batch=entries.slice(offset,offset+50);
  await client.query(apply?'BEGIN':'BEGIN READ ONLY');
  try{
   if(apply){await client.query('SELECT pg_advisory_xact_lock(714027)');
    before.assets.push(...(await client.query('SELECT * FROM media_assets WHERE url=ANY($1)',[batch.map(e=>e.media.url)])).rows);
    before.links.push(...(await client.query('SELECT * FROM entity_media WHERE entity_id=ANY($1)',[batch.map(e=>e.entity.id)])).rows);
    writeFileSync(backup,JSON.stringify(before,null,2),{mode:0o600});
   }
   report.push(...await importVerifiedLogos(new Store(postgresDatabase(client)),batch,{apply}));await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
 }
 console.log(JSON.stringify({apply,report}));
}finally{client.release();await pool.end();}
