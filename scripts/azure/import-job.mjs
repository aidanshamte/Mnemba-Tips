import { createWriteStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createPool } from '../../lib/azure/postgres.mjs';
try {
  const url = new URL(process.env.MNEMBA_SNAPSHOT_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.core.windows.net')) throw Error('Invalid backup host');
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Error('Backup download failed');
  const hash = createHash('sha256');
  const stream = Readable.fromWeb(response.body); stream.on('data', chunk => hash.update(chunk));
  await pipeline(stream, createWriteStream('/tmp/snapshot.sqlite',{mode:0o600}));
  if (hash.digest('hex') !== process.env.MNEMBA_SNAPSHOT_SHA256) throw Error('Backup checksum mismatch');
  for (let attempt=0; attempt<2; attempt++) {
    const result=spawnSync(process.execPath,['scripts/azure/migrate.mjs','/tmp/snapshot.sqlite',process.env.MNEMBA_DATABASE_SCHEMA,'/tmp/migration.json'],{stdio:'inherit'});
    if(result.status!==0)throw Error('Migration failed');
  }
  const pool=createPool();
  try {
    const password=process.env.MNEMBA_RUNTIME_PASSWORD;
    if(!/^[a-f0-9]{64}$/.test(password??''))throw Error('Runtime credential unavailable');
    const exists=await pool.query("SELECT rolname FROM pg_roles WHERE rolname='mnemba_app'");
    if(!exists.rowCount)await pool.query(`CREATE ROLE mnemba_app LOGIN PASSWORD '${password}'`);
    const schema=process.env.MNEMBA_DATABASE_SCHEMA;
    if(!/^[a-z][a-z0-9_]{0,40}$/.test(schema))throw Error('Invalid schema');
    await pool.query(`GRANT CONNECT ON DATABASE mnemba TO mnemba_app`);
    await pool.query(`GRANT USAGE ON SCHEMA "${schema}" TO mnemba_app`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO mnemba_app`);
    const tables=(await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1',[schema])).rows;
    for(const {table_name:name} of tables)if(!['_mnemba_migration','migration_conflicts'].includes(name)) {
      if(!/^[a-z_]+$/.test(name))throw Error('Invalid table name');
      await pool.query(`GRANT INSERT,UPDATE,DELETE ON "${schema}"."${name}" TO mnemba_app`);
    }
    await pool.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO mnemba_app`);
    const report=JSON.parse(readFileSync('/tmp/migration.json','utf8'));
    console.log('AZURE_MIGRATION_VERIFIED',JSON.stringify({schema,sourceSha256:report.sourceSha256,replayVerifiedAt:report.replayVerifiedAt,tables:report.tables,triggerCount:report.triggers.length}));
  } finally {await pool.end();}
} catch(error) { console.error('Import job failed:', error.code ?? (['Backup checksum mismatch','Migration failed'].includes(error.message)?error.message:'Inspect protected migration state'));process.exitCode=1; }
