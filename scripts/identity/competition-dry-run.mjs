// Competition identity dry run: plans canonical competitions from real data and writes a reviewable report.
// Never writes to the database.
//   node scripts/identity/competition-dry-run.mjs <snapshot.sqlite> <out-dir>
//   DATABASE_URL=… MNEMBA_DATABASE_SCHEMA=… node scripts/identity/competition-dry-run.mjs --postgres <out-dir>
import {mkdirSync, writeFileSync} from 'node:fs';
import {Store} from '../../lib/football/store.mjs';
import {planIdentities} from '../../lib/football/identity-migration.mjs';

const [source, outDir] = process.argv.slice(2);
if (!source || !outDir) throw Error('Usage: competition-dry-run.mjs <snapshot.sqlite | --postgres> <out-dir>');
let store, close = () => {};
if (source === '--postgres') {
  const {createPool, postgresDatabase} = await import('../../lib/azure/postgres.mjs');
  const pool = createPool(); store = new Store(postgresDatabase(pool)); close = () => pool.end();
} else {
  const {database} = await import('../../tests/football-db.mjs');
  const db = database(source); store = db.store; close = () => db.sqlite.close();
}
store.readOnly = true;
try {
  const plan = await planIdentities(store);
  mkdirSync(outDir, {recursive: true});
  writeFileSync(`${outDir}/competition-identity-plan.json`, JSON.stringify(plan, null, 1));
  const merged = plan.groups.filter(g => g.providerIds.length > 1);
  const lines = [
    '# Competition identity dry run', '', `Provider competition records: ${plan.stats.providerCompetitions}`, `Canonical competitions: ${plan.stats.canonicalCompetitions}`,
    `Provider records mapped into another record's canonical competition: ${plan.stats.merged}`, `Review items: ${plan.stats.review}`, '',
    '## Canonical competitions with more than one provider record', '', '| Canonical | Scope | Records | Providers | Distinct fixtures | Provider rows | Teams | Stages |', '|---|---|---|---|---|---|---|---|',
    ...merged.map(g => `| ${g.name} | ${g.country ?? g.governingBody ?? g.scopeKind} | ${g.providerIds.length} | ${g.providers.join(', ')} | ${g.distinctFixtures} | ${g.providerRows} | ${g.distinctTeams} | ${g.stages.map(s => s.groups.length ? `${s.name} (${s.groups.length} groups)` : s.name).join('; ')} |`),
    '', '## Merge evidence', '', '| Provider record | Canonical | Basis | Shared teams | Overlap |', '|---|---|---|---|---|',
    ...plan.memberships.filter(m => m.evidence.basis === 'team-overlap').map(m => `| ${m.providerId} | ${m.canonicalId} | ${m.evidence.basis} | ${m.evidence.shared}/${m.evidence.teams} | ${m.evidence.ratio} |`),
    '', '## Review queue (kept separate)', '', '| Kind | Provider record | Name | Reason | Evidence |', '|---|---|---|---|---|',
    ...plan.reviews.map(r => `| ${r.kind} | ${r.providerId} | ${r.name} | ${r.reason} | ${JSON.stringify(r.evidence)} |`),
  ];
  writeFileSync(`${outDir}/competition-identity-report.md`, lines.join('\n') + '\n');
  console.log(JSON.stringify(plan.stats));
} finally { await close(); }
