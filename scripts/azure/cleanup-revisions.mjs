// Post-release revision cleanup for the Mnemba Tips Azure Container App.
//
// Every active revision keeps a running replica (minReplicas 1) with its own database pool and live worker, even at
// 0% traffic. On 2026-11-21 twelve active revisions pushed PostgreSQL to its 50-connection limit ("remaining
// connection slots are reserved") and a verified release failed its fourth public round.
//
//   node scripts/azure/cleanup-revisions.mjs --serving <revision> --rollback <revision> [--dry-run] [--health <url>]
//   node scripts/azure/cleanup-revisions.mjs --abandoned <revision> [--dry-run]
//
// Rules: keep the serving revision (it must hold 100% of traffic) and exactly one rollback revision (active, 0%);
// deactivate every other active 0% revision. Never touch a revision with traffic, never delete anything, and stop
// without changes if traffic or revision information is ambiguous. Deactivated revisions can be reactivated with
// `az containerapp revision activate -g <rg> -n <app> --revision <name>`.
import {execFileSync} from 'node:child_process';

export function planCleanup(revisions, traffic, {serving, rollback}) {
  const problems = [];
  const weighted = traffic.filter(t => Number(t.weight) > 0);
  if (weighted.length !== 1 || weighted[0].revisionName !== serving || Number(weighted[0].weight) !== 100) problems.push(`serving revision must hold exactly 100% (traffic: ${JSON.stringify(weighted.map(t => [t.revisionName, t.weight]))})`);
  const byName = new Map(revisions.map(r => [r.name, r]));
  if (!byName.get(serving)?.active) problems.push(`serving revision ${serving} is not active`);
  if (!rollback || rollback === serving) problems.push('a distinct rollback revision is required');
  else if (!byName.get(rollback)?.active) problems.push(`rollback revision ${rollback} is not active`);
  else if (Number(byName.get(rollback).trafficWeight) !== 0) problems.push(`rollback revision ${rollback} has traffic`);
  if (new Set(revisions.map(r => r.name)).size !== revisions.length) problems.push('duplicate revision names');
  if (problems.length) return {ok: false, problems, keep: [], deactivate: []};
  const keep = [serving, rollback];
  const deactivate = revisions.filter(r => r.active && !keep.includes(r.name) && Number(r.trafficWeight) === 0 && !traffic.some(t => t.revisionName === r.name && Number(t.weight) > 0)).map(r => r.name);
  return {ok: true, problems, keep, deactivate};
}

export function planAbandoned(revisions, traffic, abandoned) {
  const r = revisions.find(x => x.name === abandoned);
  if (!r) return {ok: false, problems: [`revision ${abandoned} not found`], deactivate: []};
  if (Number(r.trafficWeight) !== 0 || traffic.some(t => t.revisionName === abandoned && Number(t.weight) > 0)) return {ok: false, problems: [`${abandoned} has traffic`], deactivate: []};
  if (!traffic.some(t => Number(t.weight) === 100 && t.revisionName !== abandoned)) return {ok: false, problems: ['no other revision holds 100% of traffic'], deactivate: []};
  return {ok: true, problems: [], deactivate: r.active ? [abandoned] : []};
}

// GitHub's Linux runner calls az directly; on Windows the CLI is az.cmd, which Node runs only through a shell.
const AZ = process.platform === 'win32' ? ['az.cmd', {shell: true}] : ['az', {}];
const runAz = (args, options = {}) => execFileSync(AZ[0], args.map(a => process.platform === 'win32' && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a), {...AZ[1], ...options});

const main = async () => {
  const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const dry = args.includes('--dry-run'), rg = process.env.AZURE_RESOURCE_GROUP ?? 'mnemba-azure', app = process.env.AZURE_APP ?? 'mnemba-web';
  const az = (...a) => JSON.parse(runAz([...a, '--only-show-errors', '-o', 'json'], {encoding: 'utf8'}) || 'null');
  const revisions = az('containerapp', 'revision', 'list', '-g', rg, '-n', app, '--query', '[].{name:name,active:properties.active,trafficWeight:properties.trafficWeight}');
  const traffic = az('containerapp', 'ingress', 'traffic', 'show', '-g', rg, '-n', app);
  const plan = opt('--abandoned') ? planAbandoned(revisions, traffic, opt('--abandoned')) : planCleanup(revisions, traffic, {serving: opt('--serving'), rollback: opt('--rollback')});
  console.log(JSON.stringify({dryRun: dry, ...plan}));
  if (!plan.ok) { console.error('Stopping without changes: ' + plan.problems.join('; ')); process.exit(1); }
  for (const name of plan.deactivate) {
    // Re-check immediately before acting: never deactivate a revision that has traffic.
    const live = az('containerapp', 'ingress', 'traffic', 'show', '-g', rg, '-n', app);
    if (live.some(t => t.revisionName === name && Number(t.weight) > 0)) { console.error(`Stopping: ${name} gained traffic`); process.exit(1); }
    if (dry) { console.log(`would deactivate ${name}`); continue; }
    runAz(['containerapp', 'revision', 'deactivate', '-g', rg, '-n', app, '--revision', name, '--only-show-errors', '-o', 'none']);
    console.log(`deactivated ${name}`);
  }
  const health = opt('--health');
  if (health && !dry) {
    const r = await fetch(health, {signal: AbortSignal.timeout(30000)}).catch(() => null);
    console.log(`health ${r?.status ?? 'unreachable'}`);
    if (r?.status !== 200) { console.error('Production health check failed after cleanup; reactivate with: az containerapp revision activate'); process.exit(1); }
  }
};
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cleanup-revisions.mjs')) await main();
