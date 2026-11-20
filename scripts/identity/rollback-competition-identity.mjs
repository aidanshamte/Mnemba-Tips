// Roll back the canonical competition identity to the mapping recorded in a backup-data.mjs export.
// Restores entity_aliases.canonical_id/verified/source_url for competition provider records and
// fixture_identities.competition_canonical, then removes competition:* canonical rows nothing references.
// Provider records, fixtures, forecasts and evidence are not touched.
//   node scripts/identity/rollback-competition-identity.mjs <backup.ndjson.gz> <target.sqlite>
//   DATABASE_URL=… MNEMBA_DATABASE_SCHEMA=… node scripts/identity/rollback-competition-identity.mjs <backup.ndjson.gz> --postgres
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {Store} from '../../lib/football/store.mjs';

const [file, target] = process.argv.slice(2);
if (!file || !target) throw Error('Usage: rollback-competition-identity.mjs <backup.ndjson.gz> <target.sqlite | --postgres>');
let store, close = () => {};
if (target === '--postgres') {
  const {createPool, postgresDatabase} = await import('../../lib/azure/postgres.mjs');
  const pool = createPool(); store = new Store(postgresDatabase(pool)); close = () => pool.end();
} else {
  const {database} = await import('../../tests/football-db.mjs');
  const db = database(target); store = db.store; close = () => db.sqlite.close();
}
const competitions = new Set(), aliases = [], identities = [];
let header = null;
for await (const line of createInterface({input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity})) {
  if (!line) continue;
  if (!header) { header = JSON.parse(line); continue; }
  const t = line.slice(10, line.indexOf('"', 10));
  if (t === 'competitions') competitions.add(JSON.parse(line).row.id);
  else if (t === 'entity_aliases') aliases.push(JSON.parse(line).row);
  else if (t === 'fixture_identities') { const r = JSON.parse(line).row; identities.push([r.fixture_id, r.competition_canonical]); }
}
try {
  const statements = [];
  for (const a of aliases.filter(a => competitions.has(a.provider_id))) statements.push(['UPDATE entity_aliases SET canonical_id=?,verified=?,source_url=? WHERE provider_id=?', a.canonical_id, a.verified, a.source_url, a.provider_id]);
  // Aliases the identity apply created (no row in the backup) are removed.
  const known = new Set(aliases.map(a => a.provider_id));
  for (const r of await store.all("SELECT provider_id FROM entity_aliases WHERE canonical_id LIKE 'competition:%'")) if (!known.has(r.provider_id)) statements.push(['DELETE FROM entity_aliases WHERE provider_id=? AND canonical_id LIKE ?', r.provider_id, 'competition:%']);
  for (const [fixtureId, competitionCanonical] of identities) statements.push(['UPDATE fixture_identities SET competition_canonical=? WHERE fixture_id=? AND competition_canonical LIKE ?', competitionCanonical, fixtureId, 'competition:%']);
  statements.push(["DELETE FROM canonical_entities WHERE id LIKE 'competition:%' AND id NOT IN (SELECT canonical_id FROM entity_aliases) AND id NOT IN (SELECT competition_canonical FROM fixture_identities WHERE competition_canonical IS NOT NULL)"]);
  statements.push(["DELETE FROM verification_queue WHERE id LIKE 'identity:%'"]);
  await store.batch(statements);
  const remaining = (await store.one("SELECT COUNT(*) n FROM entity_aliases WHERE canonical_id LIKE 'competition:%'")).n;
  console.log(JSON.stringify({backupAt: header.at, aliasesRestored: aliases.filter(a => competitions.has(a.provider_id)).length, fixtureIdentitiesChecked: identities.length, competitionAliasesRemaining: Number(remaining)}));
} finally { await close(); }
