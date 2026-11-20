// Consistent, bounded-memory PostgreSQL data export to a private Azure blob.
//   MNEMBA_BACKUP_URL     https://<account>.blob.core.windows.net/<container>/<name>.ndjson.gz?<write-only SAS>
//   MNEMBA_BACKUP_TABLES  "all" for every table in the schema (default: football data tables only)
// One REPEATABLE READ, READ ONLY transaction; rows stream through gzip straight into 8 MiB blob blocks
// (no temporary file), so database size never has to fit in memory or ephemeral storage.
// Output line: mnemba_backup {"tables":{name:count},"bytes":…,"sha256":…} — no credentials are logged.
import {createGzip} from 'node:zlib';
import {createHash, randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const {createPool} = await import(process.env.MNEMBA_POSTGRES_MODULE ?? '../../lib/azure/postgres.mjs');
const FOOTBALL = new Set(['fixtures','competitions','seasons','countries','football_teams','season_teams','team_form','predictions','prediction_results','analysis_forecasts','analysis_grades','analysis_grade_audit','exploratory_estimates','fixture_identities','canonical_entities','entity_aliases','field_claims','evidence_conflicts','source_files','recommendation_lists','recommendation_grades']);
// Tables whose rows carry multi-megabyte evidence lists are fetched a few rows at a time.
const WIDE = new Set(['analysis_forecasts', 'prematch_snapshots']);
const BLOCK = 8 * 1024 * 1024;

const url = new URL(process.env.MNEMBA_BACKUP_URL ?? 'invalid:');
if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.core.windows.net')) throw Error('Private backup destination required');
const pool = createPool(), client = await pool.connect();

async function put(query, body, headers = {}) {
  const target = new URL(url); for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(target, {method: 'PUT', body, headers: {'x-ms-version': '2021-08-06', ...headers}, signal: AbortSignal.timeout(300000)});
    if (r.ok) return;
    if (attempt >= 4) throw Error(`Backup upload failed: HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 2000 * attempt));
  }
}

try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const schema = process.env.MNEMBA_DATABASE_SCHEMA ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error('Invalid schema');
  const all = process.env.MNEMBA_BACKUP_TABLES === 'all';
  const columns = (await client.query('SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position', [schema])).rows.filter(c => all || FOOTBALL.has(c.table_name));
  const report = {at: new Date().toISOString(), schema, scope: all ? 'all' : 'football', tables: {}};

  async function* records() {
    yield JSON.stringify({format: 'mnemba-football-data-v1', ...report, columns}) + '\n';
    for (const table of [...new Set(columns.map(c => c.table_name))]) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw Error('Invalid identifier');
      report.tables[table] = 0;
      await client.query(`DECLARE backup_cursor NO SCROLL CURSOR FOR SELECT * FROM "${schema}"."${table}"`);
      for (;;) {
        const {rows} = await client.query(`FETCH ${WIDE.has(table) ? 5 : 250} FROM backup_cursor`);
        if (!rows.length) break;
        for (const row of rows) { yield JSON.stringify({table, row}) + '\n'; report.tables[table]++; }
      }
      await client.query('CLOSE backup_cursor');
    }
  }

  // Gzip output → sha256 + 8 MiB blocks (Put Block), committed once with Put Block List.
  const hash = createHash('sha256'), blocks = []; let pending = [], size = 0, bytes = 0;
  const flush = async () => {
    if (!size) return;
    const id = Buffer.from(randomUUID()).toString('base64'), body = Buffer.concat(pending, size);
    await put({comp: 'block', blockid: id}, body); blocks.push(id); pending = []; size = 0;
  };
  const sink = new Writable({
    async write(chunk, _enc, done) {
      try { hash.update(chunk); bytes += chunk.length; pending.push(chunk); size += chunk.length; if (size >= BLOCK) await flush(); done(); } catch (e) { done(e); }
    },
    async final(done) { try { await flush(); done(); } catch (e) { done(e); } },
  });
  await pipeline(Readable.from(records()), createGzip({level: 6}), sink);
  await client.query('COMMIT');
  const list = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blocks.map(b => `<Latest>${b}</Latest>`).join('')}</BlockList>`;
  await put({comp: 'blocklist'}, list, {'Content-Type': 'application/xml', 'x-ms-blob-content-type': 'application/gzip', 'If-None-Match': '*'});
  console.log('mnemba_backup ' + JSON.stringify({...report, blocks: blocks.length, bytes, sha256: hash.digest('hex'), finishedAt: new Date().toISOString()}));
} finally { client.release(); await pool.end(); }
