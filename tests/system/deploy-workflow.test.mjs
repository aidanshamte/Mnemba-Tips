// Deployment safety: a push to main must never send public traffic to a new revision, move the
// scheduled jobs, or deploy a mutable "latest" tag. Traffic moves only through explicit stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/azure-deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const release = readFileSync(new URL('../../scripts/azure/release.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const job = name => { const start = workflow.indexOf(`\n  ${name}:\n`); assert.ok(start > 0, `job ${name}`); const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/); return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next); };

test('push deploys an immutable candidate at 0% traffic and verifies it directly', () => {
  const candidate = job('candidate');
  assert.match(candidate, /github\.event_name == 'push'/);
  assert.match(candidate, /mnemba:\$GITHUB_SHA/);
  assert.match(candidate, /RepoDigests/);
  assert.ok(!/:latest\b/.test(workflow), 'no mutable latest tag');
  assert.match(candidate, /release\.sh prepare/);
  assert.match(candidate, /release\.sh deploy "\$\{\{ steps\.image\.outputs\.digest \}\}" "r-\$\{GITHUB_SHA::12\}"/);
  assert.match(candidate, /verify-revision\.mjs "\$\{\{ steps\.deploy\.outputs\.url \}\}"/);
  assert.match(candidate, /revision deactivate/);
  for (const forbidden of ['ingress traffic set', 'release.sh traffic', 'job update', 'release.sh jobs', 'containerapp update'])
    assert.ok(!candidate.includes(forbidden), `candidate job must not ${forbidden}`);
});

test('traffic moves only by explicit atomic cutover, jobs move only at 100%, failures roll back', () => {
  const shift = job('shift-traffic');
  assert.match(shift, /inputs\.action == 'shift-traffic'/);
  // Weighted per-request splits are refused: hashed Next.js chunks exist in only one revision and
  // Azure offers no sticky sessions in multiple-revision mode.
  assert.match(shift, /== 100 \]\]/);
  assert.match(release, /refusing a weighted split/);
  assert.match(shift, /verify-revision\.mjs https:\/\/aidanshamte\.me/);
  assert.match(shift, /if: inputs\.weight == '100'\n\s+run: \|\n[\s\S]*release\.sh jobs/);
  assert.match(shift, /if: failure\(\)[\s\S]*release\.sh rollback/);
  assert.match(job('rollback'), /release\.sh rollback "\$\{\{ inputs\.revision \}\}"/);
});

test('release script pins traffic before creating revisions and never deletes them', () => {
  assert.match(release, /set-mode -g "\$RG" -n "\$APP" --mode Multiple/);
  assert.match(release, /--revision-weight "\$stable=100"/);
  const deploy = release.slice(release.indexOf('  deploy)'), release.indexOf('  traffic)'));
  assert.match(deploy, /--revision-suffix/);
  assert.match(deploy, /unexpectedly has/);
  assert.match(deploy, /--label candidate/);
  assert.ok(!/revision (delete|deactivate)|containerapp delete|job delete|job create/.test(release));
});
