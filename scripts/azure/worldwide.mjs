import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {coverageMatrix,selectPriorityFiles} from '../../lib/football/priority-coverage.mjs';
import {ModelLab} from '../../lib/football/model-lab.mjs';
const pool=createPool();
try{
 const store=new Store(postgresDatabase(pool)),service=new IntelligenceService(store,process.env),outcomes=[];
 if(process.argv.includes('--import')){
  await service.initialize();
  const files=await store.all("SELECT * FROM source_files WHERE state='pending' AND year>=? ORDER BY year DESC,path",new Date().getUTCFullYear()-2);
  for(const f of selectPriorityFiles(files,new Date().getUTCFullYear()).slice(0,4)){const result=await service.sync('history',f.id);outcomes.push({file:f.path,...result});if(result.skipped)break;}
 }
 if(process.argv.includes('--openliga')){await service.initialize();outcomes.push(await service.sync('openligadb'));}
 console.log(JSON.stringify({at:store.now(),outcomes,coverage:await coverageMatrix(service),metrics:await new ModelLab(service).performance()}));
}finally{await pool.end();}
