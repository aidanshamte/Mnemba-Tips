import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {liveTick,publishLive} from '../../lib/football/live.mjs';
import {fdfaLiveTick} from '../../lib/football/fivedollar.mjs';
const pool=createPool(),store=new Store(postgresDatabase(pool));let stopping=false,timer,wake;
const stop=()=>{stopping=true;clearTimeout(timer);wake?.();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
const pause=ms=>new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,ms);});
try{
 const service=new IntelligenceService(store,process.env);await service.initialize();
 while(!stopping){
  const client=await pool.connect();let result;
  try{const {rows}=await client.query('SELECT pg_try_advisory_lock(714026) AS locked');if(rows[0].locked){
   // Batched paid-provider live tick first (own cadence, shared limiter), then the per-fixture LiveScore task.
   const fdfa=await fdfaLiveTick(service,{publish:id=>publishLive(service,id)}).catch(e=>({state:'error',error:String(e.message).slice(0,200)}));
   if(fdfa.state!=='not-due')console.log('mnemba_live_fdfa',JSON.stringify(fdfa));
   result=await liveTick(service);
  }}
  catch{result={state:'database-unavailable'};}
  finally{await client.query('SELECT pg_advisory_unlock(714026)').catch(()=>{});client.release();}
  if(result)console.log('mnemba_live',JSON.stringify(result));
  if(!stopping)await pause(result?.state==='not-configured'?300000:Math.max(15000,Number(process.env.MNEMBA_LIVE_TICK_MS)||30000));
 }
}finally{await pool.end();}
