import {assertRemoteAllowed} from './runtime-mode.mjs';
assertRemoteAllowed();
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=resolve(process.argv[2]??'');
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const database=config.d1_databases.find(d=>d.binding==='DB');
if(database?.database_id!=='9bd94397-cfba-4174-940f-e34fec53e1f5'||database.database_name!=='mnemba-tips-db')throw Error('Unexpected production target');
const checkpoint=join(directory,'remote-import.json');
if(existsSync(checkpoint))throw Error('Import already attempted. Inspect checkpoint and remote state before any retry.');
const env={...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
function wrangler(args){
 const r=spawnSync('pnpm',['exec','wrangler',...args],{env,encoding:'utf8',maxBuffer:32*1024*1024});
 if(r.status!==0)throw Error(`Wrangler failed: ${r.stderr||r.stdout}`);
 return r.stdout;
}
wrangler(['whoami']);
const info=wrangler(['d1','info',database.database_name,'--json']);
if(!info.includes(database.database_id))throw Error('Remote database verification failed');
const tables=Object.keys(manifest.exported);
function counts(){
 const rows=[];
 for(let offset=0;offset<tables.length;offset+=10){
  const sql=tables.slice(offset,offset+10).map(t=>`SELECT '${t}' AS name, count(*) AS count FROM "${t}"`).join('; ');
  const response=JSON.parse(wrangler(['d1','execute',database.database_name,'--remote','--config','wrangler.jsonc','--command',sql,'--json']));
  rows.push(...response.flatMap(r=>r.results));
 }
 return Object.fromEntries(rows.map(r=>[r.name,r.count]));
}
const before=counts();
if(Object.values(before).some(n=>n!==0))throw Error('Remote application tables are not empty; refusing to merge/overwrite data');
const report={target:database.database_id,started:new Date().toISOString(),before,completedFiles:[],state:'running'};
const save=()=>writeFileSync(checkpoint,JSON.stringify(report,null,2));save();
try {
 for(const file of manifest.files){
  report.currentFile=file;save();
  wrangler(['d1','execute',database.database_name,'--remote','--config','wrangler.jsonc','--file',join(directory,file),'--yes','--json']);
  report.completedFiles.push(file);save();console.log(`Imported ${report.completedFiles.length}/${manifest.files.length}: ${file}`);
 }
 report.after=counts();
 for(const table of tables)if(report.after[table]!==manifest.exported[table])throw Error('Count mismatch: '+table);
 const constraints=JSON.parse(wrangler(['d1','execute',database.database_name,'--remote','--config','wrangler.jsonc','--command','PRAGMA foreign_key_check','--json']));
 if(constraints.some(r=>r.results.length))throw Error('Remote foreign key violations');
 report.inserted=Object.values(report.after).reduce((a,b)=>a+b,0);report.failed=0;report.skipped=manifest.skipped;
 report.state='verified';report.finished=new Date().toISOString();delete report.currentFile;save();
 console.log(JSON.stringify({state:report.state,inserted:report.inserted,failed:0,skipped:report.skipped}));
}catch(error){report.state='needs-reconciliation';report.error=error.message;save();throw error;}
