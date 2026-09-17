import {readFileSync} from 'node:fs';
export function runtimeMode(){
 let local='';try{local=readFileSync(new URL('../.env.local',import.meta.url),'utf8').match(/^MNEMBA_RUNTIME_MODE\s*=\s*["']?(\w+)/m)?.[1]??'';}catch(e){if(e.code!=='ENOENT')throw e;}
 // A checkout-local safety switch cannot be overridden by a shell variable.
 return local==='local'?'local':process.env.MNEMBA_RUNTIME_MODE??local;
}
export function assertRemoteAllowed(){if(runtimeMode()==='local')throw Error('Remote Cloudflare operations disabled: MNEMBA_RUNTIME_MODE=local.');}
export function assertLocalOrigin(origin){const u=new URL(origin);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Local maintenance requires a loopback URL. Remote origins are disabled.');return origin;}
export function announceLocal(){console.log('Mnemba Tips mode: LOCAL\nDatabase: local persistent D1 (.wrangler/state)\nRemote Cloudflare calls: disabled');}
