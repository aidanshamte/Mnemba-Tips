import {rejectOtherServer,acquireServerLease} from './local-origin.mjs';
await rejectOtherServer(5173);
await acquireServerLease('http://127.0.0.1:8787');
import './sites-env.mjs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const cli=new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url);
// An absolute path is necessary: Wrangler otherwise looks beside dist/server/wrangler.json.
const child=spawn(process.execPath,[fileURLToPath(cli),'dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip','127.0.0.1','--port','8787','--inspector-port','0','--env-file',fileURLToPath(new URL('../.env.local',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
