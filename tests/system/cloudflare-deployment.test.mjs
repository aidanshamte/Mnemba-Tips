import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { database } from '../football-db.mjs';
import { runScheduled, boundedDatabase } from '../../lib/football/scheduled.mjs';

const migrations = readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort();
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(r=>({...r,sql:r.sql.replace(/IF NOT EXISTS/gi,'').replace(/\s+/g,' ').replace(/\s*([(),;])\s*/g,'$1').trim().replace(/;$/,'')}));
test('versioned production migrations contain the complete runtime schema and basketball schema',async()=>{
  const production=new DatabaseSync(':memory:'), runtime=database();
  try {
    production.exec('PRAGMA foreign_keys=ON');
    for(const file of migrations) production.exec(readFileSync('drizzle/'+file,'utf8'));
    runtime.sqlite.exec(readFileSync('drizzle/'+migrations[0],'utf8'));
    await runtime.store.init();await runtime.store.init();
    assert.deepEqual(schema(production),schema(runtime.sqlite));
    assert.deepEqual(production.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {production.close();runtime.sqlite.close();}
});
test('cron duplicate delivery and overlapping invocations do not repeat work',async()=>{
  const {store,db,sqlite}=database(); await store.init();let calls=0;
  const service={initialize:async()=>{},sync:async()=>{calls++;return {outcome:'success'};}};
  const event={cron:'0 * * * *',scheduledTime:123};
  try {
    const owner=await store.lock('cloudflare-cron',600000);
    assert.equal((await runScheduled(event,{DB:db},{service})).state,'skipped');assert.equal(calls,0);
    await store.unlock('cloudflare-cron',owner);
    assert.equal((await runScheduled(event,{DB:db},{service})).state,'success');assert.equal(calls,4);
    assert.equal((await runScheduled(event,{DB:db},{service})).state,'skipped');assert.equal(calls,4);
  }finally{sqlite.close();}
});
test('cron records failures, respects due times and releases its own lease',async()=>{
  const {store,db,sqlite}=database();await store.init();const called=[];
  try {
    await store.run("INSERT INTO update_jobs(id,interval_ms,next_run,state,payload) VALUES('fixtures',1,?,'success','{}')",Date.now()+3600000);
    const result=await runScheduled({cron:'0 * * * *',scheduledTime:124},{DB:db},{service:{initialize:async()=>{},sync:async job=>{called.push(job);if(job==='results')throw Error('Provider unavailable');return {outcome:'success'};}}});
    assert.equal(result.state,'partial');assert.deepEqual(called,['results','models','snapshots']);
    assert.equal((await store.one('SELECT state FROM cron_runs')).state,'partial');
    assert.equal(await store.one("SELECT * FROM sync_locks WHERE id='cloudflare-cron'"),null);
  }finally{sqlite.close();}
});
test('deadline prevents writes after timeout',async()=>{
  const {db,sqlite}=database();let expired=false;
  try {const bounded=boundedDatabase(db,()=>{if(expired)throw Error('Deadline');});const stmt=bounded.prepare('CREATE TABLE should_not_exist(id TEXT)');expired=true;assert.throws(()=>stmt.run(),/Deadline/);assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='should_not_exist'").get(),undefined);}finally{sqlite.close();}
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('transfer retains saved badge metadata while excluding disposable cache rows',()=>{
  const root=mkdtempSync(join(tmpdir(),'mnemba-export-')),path=join(root,'source.sqlite');
  const db=new DatabaseSync(path);
  try {
    for(const file of migrations)db.exec(readFileSync('drizzle/'+file,'utf8'));
    db.prepare('INSERT INTO football_cache VALUES(?,?,?,?)').run('public-badges','{"badges":{"test":{"url":"https://www.thesportsdb.com/images/media/team/badge/test.png"}}}',1,2);
    db.prepare('INSERT INTO football_cache VALUES(?,?,?,?)').run('temporary','{}',1,2);
    db.close();
    const result=spawnSync('python3',['scripts/prepare-d1-transfer.py',path,join(root,'export')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(readFileSync(join(root,'export','manifest.json'),'utf8'));
    assert.equal(manifest.local.football_cache,2);
    assert.equal(manifest.exported.football_cache,1);
    assert.equal(manifest.skipped.football_cache.count,1);
    assert.equal(manifest.verified.football_cache,1);
  }finally{if(db.isOpen)db.close();rmSync(root,{recursive:true,force:true});}
});

import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {normalizeFixture} from '../../lib/football/providers.mjs';
import {apiFixture} from '../football-db.mjs';
import {refreshSearchIndex} from '../../lib/football/search.mjs';
test('production public reads survive D1 write denial without inventing saved forecasts',async()=>{
  const {store,db,sqlite}=database();let now=Date.parse('2026-09-10T12:00:00Z');store.now=()=>now;
  try {
    await store.init();const service=new IntelligenceService(store);await service.initialize();
    await service.saveFixtures([1,2,3,4].map(i=>normalizeFixture('api-football',apiFixture(900+i,'FT',`2026-09-0${i}T12:00:00Z`))));
    const f={...normalizeFixture('api-football',apiFixture(910,'NS','2026-09-11T12:00:00Z')),kickoffPrecision:'date'};
    await service.saveFixtures([f]);const saved=await service.read(new URLSearchParams({view:'analysis',id:f.id}));assert.ok(saved.analysis.probabilities);
    await refreshSearchIndex(store,true);now+=3600000;
    const prepare=db.prepare;db.prepare=sql=>{if(!/^\s*SELECT\b/i.test(sql))throw Error('D1 daily writes exhausted');return prepare(sql);};
    store.readOnly=true;
    for(const params of [{view:'fixtures'},{view:'global-search',q:'Team'},{view:'matchday',from:'2026-09-11',to:'2026-09-11',timezone:'UTC'},{view:'match-context',id:f.id},{view:'prediction-history'},{view:'badges'},{view:'news'},{view:'article',id:'missing'}])await service.read(new URLSearchParams(params));
    const again=await service.read(new URLSearchParams({view:'analysis',id:f.id}));assert.deepEqual(again.analysis.probabilities,saved.analysis.probabilities);assert.equal(again.analysis.asOf,saved.analysis.asOf);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM exploratory_estimates').get().n,1);
  }finally{sqlite.close();}
});
