import {spawn} from 'node:child_process';
// The web process owns container health. Worker failures retry without stopping HTTP.
const web=spawn(process.execPath,['server.js'],{stdio:'inherit'});
let worker,timer,stopping=false;
const startWorker=()=>{
 if(stopping)return;
 worker=spawn(process.execPath,['--max-old-space-size=256','scripts/azure/live-worker.mjs'],{stdio:'inherit'});
 worker.on('error',error=>console.error('mnemba_live_spawn',error.message));
 worker.on('exit',(code,signal)=>{console.error('mnemba_live_exit',JSON.stringify({code,signal}));worker=undefined;if(!stopping)timer=setTimeout(startWorker,60000);});
};
const stop=()=>{if(stopping)return;stopping=true;clearTimeout(timer);web.kill('SIGTERM');worker?.kill('SIGTERM');};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
web.on('error',error=>{console.error('mnemba_web_spawn',error.message);process.exitCode=1;stop();});
web.on('exit',(code,signal)=>{if(!stopping){console.error('mnemba_web_exit',JSON.stringify({code,signal}));process.exitCode=code||1;stop();}});
if(process.env.MNEMBA_ENABLE_UPDATES==='1')startWorker();
