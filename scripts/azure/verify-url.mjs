import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const origin = process.argv[2];
const url = new URL(origin);
if (!(url.protocol === 'https:' && url.hostname.endsWith('.azurecontainerapps.io')) && !['localhost','127.0.0.1'].includes(url.hostname))
  throw new Error('Use the Azure-generated HTTPS URL or loopback rehearsal URL');
const evidence = { origin: url.origin, checkedAt: new Date().toISOString(), checks: [] };
async function check(path, status=200) {
  const response = await fetch(url.origin+path, { signal: AbortSignal.timeout(90000), redirect:'manual' });
  assert.equal(response.status,status,path);
  evidence.checks.push({ path, status }); return response;
}
const health = await (await check('/api/health')).json();
assert.equal(health.database,'ready');
for (const path of ['/football','/football/search?kind=team&q=Arsenal','/football/predictions','/football/shortlists','/basketball']) await check(path);
const fixtures=await(await check('/api/intelligence?view=fixtures')).json();
assert.ok(JSON.stringify(fixtures).length>100,'Fixture payload cannot be empty');
const search=await(await check('/api/intelligence?view=global-search&kind=team&q=Arsenal')).json();
assert.ok(search.results?.length,'Persisted team must be found');
await check(search.results[0].url);
await check('/api/intelligence?view=diagnostics',403);
const oldLab=await check('/lab',307);assert.equal(oldLab.headers.get('location'),'/football');
evidence.basketball = 'Basketball demo route returns 200; model scenarios and selection are checked by the browser suite.';
writeFileSync(process.argv[3] ?? '.sites-runtime/azure-migration/url-verification.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
