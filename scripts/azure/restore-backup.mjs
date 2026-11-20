// Restore a backup-data.mjs export into a fresh SQLite database created by the application's own schema.
// The SQLite file can then be loaded into PostgreSQL with scripts/azure/migrate.mjs, which is how the
// production schema was originally created. This is the documented restore path for release backups.
//
//   node scripts/azure/restore-backup.mjs <backup.ndjson.gz> <out.sqlite> [--strip-evidence]
//
// --strip-evidence replaces analysis_forecasts/prematch_snapshots.evidence_ids with "[]" for local analysis
// copies (those lists are audit-only and account for most of the backup size). Never use it for a real restore.
import {createReadStream, existsSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {database} from '../../tests/football-db.mjs';

const [file, out, flag] = process.argv.slice(2);
if (!file || !out) throw Error('Usage: node scripts/azure/restore-backup.mjs <backup.ndjson.gz> <out.sqlite> [--strip-evidence]');
if (existsSync(out)) throw Error('Refusing to overwrite an existing database file');
const strip = flag === '--strip-evidence';
const {store, sqlite} = database(out);
await store.init();
sqlite.exec('PRAGMA foreign_keys=OFF; PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF');
const tableColumns = new Map(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  .map(({name}) => [name, new Set(sqlite.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name))]));
// Restoring history must not trip the immutability triggers meant for live writes.
const triggers = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'").all();
for (const t of triggers) sqlite.exec(`DROP TRIGGER "${t.name}"`);

let header = null, batch = 0;
const counts = {}, skipped = {}, prepared = new Map();
sqlite.exec('BEGIN');
for await (const line of createInterface({input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity})) {
  if (!line) continue;
  if (!header) { header = JSON.parse(line); if (header.format !== 'mnemba-football-data-v1') throw Error('Unknown backup format'); continue; }
  const {table, row} = JSON.parse(line);
  const columns = tableColumns.get(table);
  if (!columns) { skipped[table] = (skipped[table] ?? 0) + 1; continue; }
  if (strip && 'evidence_ids' in row && (table === 'analysis_forecasts' || table === 'prematch_snapshots')) row.evidence_ids = '[]';
  const keys = Object.keys(row).filter(k => columns.has(k));
  const sig = table + '|' + keys.join(',');
  if (!prepared.has(sig)) prepared.set(sig, sqlite.prepare(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`));
  prepared.get(sig).run(...keys.map(k => typeof row[k] === 'boolean' ? Number(row[k]) : row[k]));
  counts[table] = (counts[table] ?? 0) + 1;
  if (++batch % 20000 === 0) { sqlite.exec('COMMIT'); sqlite.exec('BEGIN'); }
}
sqlite.exec('COMMIT');
for (const t of triggers) sqlite.exec(t.sql);
sqlite.exec('PRAGMA foreign_keys=ON');
const fk = sqlite.prepare('PRAGMA foreign_key_check').all().length;
sqlite.close();

console.log(JSON.stringify({restoredFrom: file, backupAt: header.at, schema: header.schema, strippedEvidence: strip, rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: Object.keys(counts).length, foreignKeyViolations: fk, skipped, counts}, null, 1));
