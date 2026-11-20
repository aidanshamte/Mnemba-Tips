import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {coverageMatrix,selectPriorityFiles} from '../../lib/football/priority-coverage.mjs';
import {reconcileGeneratedMirrors} from '../../lib/football/mirrors.mjs';
import {FIRST_BATCH,batchCompetition} from '../../lib/football/global-competitions.mjs';

export async function globalCoverage(service,{importData=false}={}){
 const s=service.store,year=new Date(s.now()).getUTCFullYear(),outcomes=[];
 if(importData){
  await service.initialize();
  // Reuse the existing permitted discovery/HTTP quota/cache pipeline.
  for(const repository of ['world','south-america','football.json'])await service.open.discover(repository);
  const files=await s.all('SELECT * FROM source_files WHERE year>=? AND year<=? ORDER BY year DESC,path',year-3,year);
  const selected=selectPriorityFiles(files,year).filter(f=>batchCompetition(f));
  for(const f of selected){
   const result=await service.sync('history',f.id);outcomes.push({competition:batchCompetition(f).id,file:f.path,...result});
   if(result.skipped)break;
  }
 }
 if(importData)await reconcileGeneratedMirrors(service);
 const coverage=await coverageMatrix(service);
 return{at:s.now(),outcomes,firstBatch:coverage.competitions.filter(c=>FIRST_BATCH.some(p=>p.id===c.id)),coverage,sourceUsage:await s.all('SELECT * FROM source_request_usage WHERE day=?',s.day()),sourceStatus:await s.all('SELECT id,last_success,last_error,next_allowed_at FROM source_registry')};
}
if(process.argv[1]?.endsWith('/azure/global-coverage.mjs')){
 const {createPool,postgresDatabase}=await import('../../lib/azure/postgres.mjs');
 const pool=createPool();try{console.log(JSON.stringify(await globalCoverage(new IntelligenceService(new Store(postgresDatabase(pool)),process.env),{importData:process.argv.includes('--import')})));}finally{await pool.end();}
}
