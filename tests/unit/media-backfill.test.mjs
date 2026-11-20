import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../football-db.mjs';
import {importVerifiedLogos} from '../../lib/football/media-backfill.mjs';
test('media transfer requires exact destination identity, fresh decoded content and permission; dry run writes nothing',async()=>{
 const {store,sqlite}=database();try{await store.init();
 await store.upsert('football_teams',{id:'provider:1',provider:'provider',external_id:'1',name:'Club',country_id:null,payload:'{}',updated_at:1});
 const entry={entity:{id:'provider:1',type:'team',name:'Club'},basis:'Exact provider identity',media:{url:'https://r2.thesportsdb.com/images/media/team/badge/a.png',sourceUrl:'https://www.thesportsdb.com/team/1',attribution:'Club',usageBasis:'Owner permission',publicDisplayAllowed:true,permissionEvidence:'Owner instruction',contentHash:'a'.repeat(64),width:64,height:64,lastSuccess:store.now()}};
 assert.equal((await importVerifiedLogos(store,[entry]))[0].state,'ready');assert.equal((await store.one('SELECT COUNT(*) n FROM media_assets')).n,0);
 assert.equal((await importVerifiedLogos(store,[{...entry,entity:{...entry.entity,name:'Other'}}],{apply:true}))[0].state,'unresolved');
 for(const change of [{permissionEvidence:null},{contentHash:null},{lastSuccess:1}])await assert.rejects(importVerifiedLogos(store,[{...entry,media:{...entry.media,...change}}],{apply:true}));
 await importVerifiedLogos(store,[entry],{apply:true});await importVerifiedLogos(store,[entry],{apply:true});assert.equal((await store.one('SELECT COUNT(*) n FROM entity_media')).n,1);assert.equal((await store.one('SELECT payload FROM football_teams')).payload,'{}');
 }finally{sqlite.close();}
});
