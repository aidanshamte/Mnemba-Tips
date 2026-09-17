// Read-only reconciliation plan. Never silently choose between divergent snapshots.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [localPath, remotePath, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: compare-snapshots.mjs LOCAL.sqlite REMOTE.sqlite REPORT.json');
const local = new DatabaseSync(localPath,{readOnly:true}), remote = new DatabaseSync(remotePath,{readOnly:true});
const quote = s => '"'+s.replaceAll('"','""')+'"';
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'").all().map(r=>r.name);
const hash = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const localTables=tables(local),remoteTables=tables(remote),report=[];
try {
 for(const name of new Set([...localTables,...remoteTables])) {
  if(!localTables.includes(name)||!remoteTables.includes(name)){report.push({name,onlyIn:localTables.includes(name)?'local':'remote'});continue;}
  const columns=local.prepare(`PRAGMA table_info(${quote(name)})`).all(),other=remote.prepare(`PRAGMA table_info(${quote(name)})`).all();
  if(JSON.stringify(columns)!==JSON.stringify(other)){report.push({name,schemaConflict:true});continue;}
  const pk=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name),keys=columns.map(c=>c.name);
  if(!pk.length){report.push({name,manualReview:'No primary key'});continue;}
  const records=db=>new Map(db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row=>[JSON.stringify(pk.map(k=>row[k])),hash(keys.map(k=>row[k]))]));
  const a=records(local),b=records(remote);let identical=0,conflicts=0,localOnly=0,remoteOnly=0;
  for(const [key,value] of a)if(!b.has(key))localOnly++;else if(b.get(key)===value)identical++;else conflicts++;
  for(const key of b.keys())if(!a.has(key))remoteOnly++;
  report.push({name,localCount:a.size,remoteCount:b.size,identical,conflicts,localOnly,remoteOnly});
 }
 writeFileSync(output,JSON.stringify({localPath,remotePath,comparedAt:new Date().toISOString(),tables:report},null,2),{mode:0o600});
 console.log('Comparison saved; no records changed. Resolve conflicts before promoting a combined database.');
} finally {local.close();remote.close();}
