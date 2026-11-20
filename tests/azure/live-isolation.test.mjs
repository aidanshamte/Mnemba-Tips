import test from 'node:test';
import assert from 'node:assert/strict';
import {database,apiFixture} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {liveTick,liveSnapshot} from '../../lib/football/live.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('live ingestion never loads or grades the prediction archive and restores methods',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-21T10:25:00Z');await store.init();
 const service=new IntelligenceService(store,{API_FOOTBALL_KEY:'test'},{fetcher:async()=>Response.json({response:[apiFixture(42,'FT','2026-09-21T10:00:00Z')]}),sleep:async()=>{}});await service.initialize();
 const all=store.all.bind(store);store.all=async(sql,...args)=>{assert.doesNotMatch(sql,/analysis_forecasts|model_predictions|team_form/);return all(sql,...args);};
 service.predict=service.evaluateFixture=async()=>{assert.fail('model work entered live ingestion');};
 const originalSave=service.saveFixtures,originalDetail=service.detailRecord;
 try{assert.equal((await liveTick(service)).state,'success');assert.equal((await liveSnapshot(store,'api-football:42')).fixture.homeScore,2);assert.ok(await store.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?','api-football:42'));assert.equal(service.saveFixtures,originalSave);assert.equal(service.detailRecord,originalDetail);}finally{sqlite.close();}
});
test('worker failure leaves the web process running',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemba-supervisor-'));mkdirSync(join(dir,'scripts/azure'),{recursive:true});copyFileSync(new URL('../../scripts/azure/start.mjs',import.meta.url),join(dir,'scripts/azure/start.mjs'));
 // The stub web process exits once its supervisor is gone (Windows kill() does not run the
 // supervisor's SIGTERM handler), so the temporary directory is released promptly.
 writeFileSync(join(dir,'server.js'),"console.log('web-ready');const parent=process.ppid;setInterval(()=>{try{process.kill(parent,0);}catch{process.exit(0);}console.log('web-alive');},50);");writeFileSync(join(dir,'scripts/azure/live-worker.mjs'),'process.exit(7);');
 const child=spawn(process.execPath,['scripts/azure/start.mjs'],{cwd:dir,env:{...process.env,MNEMBA_ENABLE_UPDATES:'1'},stdio:['ignore','pipe','pipe']});let output='',errors='';
 // Event-driven synchronization: wait for the observable facts instead of a fixed sleep.
 // The 10s ceiling only turns a hang into a clear failure; it never decides success.
 const waiters=new Set();const notify=()=>{for(const w of waiters)if(w.check()){waiters.delete(w);w.done();}};
 child.stdout.on('data',x=>{output+=x;notify();});child.stderr.on('data',x=>{errors+=x;notify();});
 child.on('exit',code=>{for(const w of waiters){waiters.delete(w);w.fail(new Error(`Supervisor exited (${code}) while waiting for ${w.label}\nstdout:${output}\nstderr:${errors}`));}});
 const waitFor=(label,check)=>new Promise((resolve,reject)=>{if(check())return resolve();const timer=setTimeout(()=>{waiters.delete(w);reject(new Error(`Timed out waiting for ${label}\nstdout:${output}\nstderr:${errors}`));},10000);const w={label,check,done:()=>{clearTimeout(timer);resolve();},fail:e=>{clearTimeout(timer);reject(e);}};waiters.add(w);});
 try{
  await waitFor('worker exit code 7',()=>/mnemba_live_exit.*"code":7/.test(errors));
  const afterExit=output.length;
  await waitFor('web output after the worker failed',()=>/web-alive/.test(output.slice(afterExit)));
  assert.equal(child.exitCode,null,'supervisor keeps running after the worker exits');
 }finally{const done=once(child,'exit');child.kill('SIGTERM');await done;rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
