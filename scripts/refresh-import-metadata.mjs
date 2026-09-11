// Local migration of adapter metadata from already cached source responses; no network.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../lib/football/store.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {normalizeOpenFile} from '../lib/football/adapters.mjs';
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):e.name.endsWith('.sqlite')?[join(p,e.name)]:[]);
for(const path of walk('.wrangler/state')){const sqlite=new DatabaseSync(path);if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE name='source_registry'").get()){sqlite.close();continue;}sqlite.exec('PRAGMA foreign_keys=ON');
 const adapt=(sql,args=[])=>({bind:(...values)=>adapt(sql,values),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});
 const db={prepare:sql=>adapt(sql),batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{for(const statement of statements)await statement.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const store=new Store(db),service=new IntelligenceService(store),owner=await store.lock('football-sync',600000);if(!owner)throw new Error('Wait for synchronization before metadata migration');let updated=0;
 try{for(const entry of await store.all("SELECT * FROM source_files WHERE state='imported'")){const cache=await store.one("SELECT body FROM http_response_cache WHERE source_id='openfootball' AND url=?",entry.url);if(!cache)continue;const result=await normalizeOpenFile(entry.format==='json'?JSON.parse(cache.body):cache.body,entry);if(!result.fixtures.length)continue;await service.saveCompetition(result.fixtures[0].competition,true);const lookup=new Map(result.fixtures.map(f=>[f.id,f]));for(const row of await store.all("SELECT id,payload FROM fixtures WHERE provider='openfootball' AND json_extract(payload,'$.sourceUrl')=?",entry.url)){const f=JSON.parse(row.payload),fresh=lookup.get(f.id);f.competition=result.fixtures[0].competition;if(fresh)f.round=fresh.round;await store.run('UPDATE fixtures SET payload=?,updated_at=? WHERE id=?',JSON.stringify(f),store.now(),f.id);await service.evidence.observeFixture(f);updated++;}}console.log(JSON.stringify({updated,mirrorReconciliation:await service.reconcileMirrors()}));}finally{await store.unlock('football-sync',owner);sqlite.close();}}
