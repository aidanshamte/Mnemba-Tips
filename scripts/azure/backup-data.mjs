// Consistent, bounded-memory football data export. No credentials or user tables.
import {createPool} from '../../lib/azure/postgres.mjs';
import {createGzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createWriteStream,createReadStream,statSync,unlinkSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const TABLES=new Set(['fixtures','competitions','seasons','countries','football_teams','season_teams','team_form','predictions','prediction_results','analysis_forecasts','analysis_grades','analysis_grade_audit','exploratory_estimates','fixture_identities','canonical_entities','entity_aliases','field_claims','evidence_conflicts','source_files','recommendation_lists','recommendation_grades']);
const pool=createPool(),client=await pool.connect(),path='/tmp/mnemba-football-backup.ndjson.gz';
try{
 const url=new URL(process.env.MNEMBA_BACKUP_URL??'');
 if(url.protocol!=='https:'||!url.hostname.endsWith('.blob.core.windows.net'))throw Error('Private backup destination required');
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const schema=process.env.MNEMBA_DATABASE_SCHEMA??'public',report={at:new Date().toISOString(),schema,tables:{}};
 const columns=(await client.query('SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',[schema])).rows.filter(c=>TABLES.has(c.table_name));
 async function* records(){
  yield JSON.stringify({format:'mnemba-football-data-v1',...report,columns})+'\n';
  for(const table of [...new Set(columns.map(c=>c.table_name))]){
   if(!/^[a-z_][a-z0-9_]*$/.test(table)||!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error('Invalid identifier');
   report.tables[table]=0;
   await client.query(`DECLARE backup_cursor NO SCROLL CURSOR FOR SELECT * FROM "${schema}"."${table}"`);
   for(;;){const {rows}=await client.query('FETCH 250 FROM backup_cursor');if(!rows.length)break;for(const row of rows){yield JSON.stringify({table,row})+'\n';report.tables[table]++;}}
   await client.query('CLOSE backup_cursor');
  }
 }
 await pipeline(Readable.from(records()),createGzip(),createWriteStream(path,{mode:0o600}));
 await client.query('COMMIT');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 const bytes=statSync(path).size;
 const r=await fetch(url,{method:'PUT',headers:{'x-ms-blob-type':'BlockBlob','Content-Type':'application/gzip','Content-Length':String(bytes),'If-None-Match':'*'},body:createReadStream(path),duplex:'half',signal:AbortSignal.timeout(120000)});
 if(!r.ok)throw Error('Private backup upload failed: '+r.status);
 console.log(JSON.stringify({...report,bytes,sha256:hash.digest('hex')}));unlinkSync(path);
}finally{client.release();await pool.end();}
