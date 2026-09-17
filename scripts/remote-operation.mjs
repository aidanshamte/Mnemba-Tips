import {assertRemoteAllowed} from './runtime-mode.mjs';
import {spawnSync} from 'node:child_process';
assertRemoteAllowed();
const operations={deploy:['deploy','--config','dist/server/wrangler.json'],migrate:['d1','migrations','apply','mnemba-tips-db','--remote','--config','wrangler.jsonc']};
const args=operations[process.argv[2]];if(!args)throw Error('Unknown remote operation');
const r=spawnSync('pnpm',['exec','wrangler',...args],{stdio:'inherit'});if(r.error)throw r.error;process.exitCode=r.status??1;
