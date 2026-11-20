// Production regression: analysis_forecasts.evidence_ids averages ~1.9 MB per row (5.8 GB for 3,051 rows)
// and prematch_snapshots.evidence_ids ~244 KB. Reading those columns in bulk made the scheduled jobs and the
// backup export exceed their memory limit (exit 137). Application reads must name the columns they use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const files = ['lib/football', 'lib/azure'].flatMap(dir => readdirSync(new URL(`../../${dir}/`, import.meta.url)).filter(f => f.endsWith('.mjs')).map(f => `${dir}/${f}`));

test('no application query reads every column of the wide evidence tables', () => {
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    for (const m of source.matchAll(/SELECT\s+([^'"`]*?)\s+FROM\s+(analysis_forecasts|prematch_snapshots)\b(\s+(?:AS\s+)?(\w+))?/gi)) {
      const [, columns, , , alias] = m;
      const star = new RegExp(`(^|,)\\s*(\\*|${alias ?? '\\w+'}\\.\\*)\\s*(,|$)`).test(columns);
      if (star || /evidence_ids/.test(columns)) offenders.push(`${file}: ${m[0].slice(0, 90)}`);
    }
  }
  // The protected evidence view intentionally returns one fixture's full snapshots for audit.
  assert.deepEqual(offenders.filter(o => !o.startsWith('lib/football/intelligence.mjs: SELECT * FROM prematch_snapshots WHERE')), []);
});
