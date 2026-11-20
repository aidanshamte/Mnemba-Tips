import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {coverageMatrix,selectPriorityFiles} from '../lib/football/priority-coverage.mjs';
import {ModelLab} from '../lib/football/model-lab.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const {store,sqlite}=database(populatedLocalDatabase());
try {
 const service=new IntelligenceService(store),outcomes=[];
 if(process.argv.includes('--import')){
  await service.initialize();
  const files=await store.all("SELECT * FROM source_files WHERE state='pending' AND year>=? ORDER BY year DESC,path",new Date().getUTCFullYear()-2);
  for(const file of selectPriorityFiles(files,new Date().getUTCFullYear())){
   const result=await service.sync('history',file.id);outcomes.push({file:file.path,...result});console.log(JSON.stringify(outcomes.at(-1)));
   if(result.skipped)break;
  }
 }
 const report={at:store.now(),outcomes,coverage:await coverageMatrix(service),metrics:await new ModelLab(service).performance()};
 mkdirSync('.sites-runtime/worldwide',{recursive:true});writeFileSync('.sites-runtime/worldwide/local.json',JSON.stringify(report,null,2));console.log('Saved worldwide coverage and model measurements');
}finally{sqlite.close();}
