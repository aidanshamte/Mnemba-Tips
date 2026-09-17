import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assertLocalOrigin} from '../../scripts/runtime-mode.mjs';
test('local maintenance cannot use a public or Cloudflare origin',()=>{
 for(const url of ['https://example.com','https://mnemba-tips.kaidan547.workers.dev','http://localhost.evil.test'])assert.throws(()=>assertLocalOrigin(url),/loopback/);
 assert.equal(assertLocalOrigin('http://127.0.0.1:5173'),'http://127.0.0.1:5173');
});
test('local mode blocks deployment, remote migration and transfer before spawning Wrangler',()=>{
 for(const args of [['scripts/remote-operation.mjs','deploy'],['scripts/remote-operation.mjs','migrate'],['scripts/import-d1-transfer.mjs','/nonexistent']]){
  const r=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,MNEMBA_RUNTIME_MODE:'local'}});assert.notEqual(r.status,0);assert.match(r.stderr,/Remote Cloudflare operations disabled/);
 }
});
