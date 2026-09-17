import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPool} from '../../lib/azure/postgres.mjs';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(!report.verified)throw new Error('Expected a successful migration manifest');
const pool=createPool();
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
 for(const table of report.tables){
  const rows=(await pool.query(`SELECT * FROM ${quote(report.schema)}.${quote(table.name)}`)).rows;
  const columns=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[report.schema,table.name])).rows.map(c=>c.column_name);
  const content=hash(rows.map(row=>hash(columns.map(c=>row[c]))).sort());
  if(rows.length!==table.sourceCount||content!==table.sha256)throw new Error(`Mismatch: ${table.name}`);
 }
 console.log(`PASS ${report.tables.length} table counts and content hashes`);
}finally{await pool.end();}
