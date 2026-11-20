import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {globalCoverage} from './azure/global-coverage.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const {store,sqlite}=database(populatedLocalDatabase());
try{const report=await globalCoverage(new IntelligenceService(store),{importData:process.argv.includes('--import')});mkdirSync('.sites-runtime/global-coverage',{recursive:true});writeFileSync('.sites-runtime/global-coverage/local.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.firstBatch.map(({id,fixtures,results,scheduled,status,upcomingPredictions})=>({id,fixtures,results,scheduled,status,upcomingPredictions}))));}finally{sqlite.close();}
