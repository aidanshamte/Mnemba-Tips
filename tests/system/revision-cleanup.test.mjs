// Post-release revision cleanup (2026-11-21: twelve active revisions exhausted the 50-connection database limit).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planCleanup, planAbandoned} from '../../scripts/azure/cleanup-revisions.mjs';

const rev = (name, active, trafficWeight = 0) => ({name, active, trafficWeight});
const revisions = [rev('r-old1', true), rev('r-old2', true), rev('r-gone', false), rev('r-rollback', true), rev('r-serving', true, 100), rev('r-failed', true)];
const traffic = [{revisionName: 'r-serving', weight: 100, label: 'candidate'}, {revisionName: 'r-rollback', weight: 0, label: 'previous'}];

test('keeps the serving revision and one rollback, deactivates every other active 0% revision', () => {
  const plan = planCleanup(revisions, traffic, {serving: 'r-serving', rollback: 'r-rollback'});
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.keep, ['r-serving', 'r-rollback']);
  assert.deepEqual(plan.deactivate.sort(), ['r-failed', 'r-old1', 'r-old2']);
});

test('stops without changes when traffic or revision information is ambiguous', () => {
  for (const [why, revs, t, sel] of [
    ['split traffic', revisions, [{revisionName: 'r-serving', weight: 90}, {revisionName: 'r-old1', weight: 10}], {serving: 'r-serving', rollback: 'r-rollback'}],
    ['serving not 100%', revisions, [{revisionName: 'r-old1', weight: 100}], {serving: 'r-serving', rollback: 'r-rollback'}],
    ['rollback inactive', revisions, traffic, {serving: 'r-serving', rollback: 'r-gone'}],
    ['no rollback', revisions, traffic, {serving: 'r-serving', rollback: ''}],
    ['rollback equals serving', revisions, traffic, {serving: 'r-serving', rollback: 'r-serving'}],
    ['duplicate names', [...revisions, rev('r-old1', true)], traffic, {serving: 'r-serving', rollback: 'r-rollback'}],
  ]) { const plan = planCleanup(revs, t, sel); assert.equal(plan.ok, false, why); assert.deepEqual(plan.deactivate, [], why); }
});

test('never selects a revision that has traffic, even if the revision list disagrees', () => {
  const plan = planCleanup([...revisions, rev('r-label-lag', true, 0)], [...traffic, {revisionName: 'r-label-lag', weight: 0}], {serving: 'r-serving', rollback: 'r-rollback'});
  assert.ok(!plan.deactivate.includes('r-serving') && !plan.deactivate.includes('r-rollback'));
});

test('an abandoned candidate is deactivated only at 0% while another revision serves 100%', () => {
  assert.deepEqual(planAbandoned(revisions, traffic, 'r-failed').deactivate, ['r-failed']);
  assert.equal(planAbandoned(revisions, traffic, 'r-serving').ok, false);
  assert.equal(planAbandoned(revisions, [{revisionName: 'r-failed', weight: 0}], 'r-failed').ok, false);
});

test('the workflow cleans up after a verified 100% cutover without risking a rollback, and never deletes', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/azure-deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const script = readFileSync(new URL('../../scripts/azure/cleanup-revisions.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /Move the existing scheduled jobs[\s\S]*Deactivate superseded revisions[\s\S]*continue-on-error: true[\s\S]*cleanup-revisions\.mjs --serving "\$\{\{ inputs\.revision \}\}" --rollback "\$\{\{ steps\.shift\.outputs\.stable \}\}" --health/);
  assert.match(workflow, /upload-artifact[\s\S]*Deactivate the abandoned candidate[\s\S]*cleanup-revisions\.mjs --abandoned/);
  for (const forbidden of ['revision delete', "'delete'", 'acr repository delete', 'acr manifest delete']) assert.ok(!script.includes(forbidden) && !workflow.includes(forbidden), forbidden);
  assert.match(script, /--dry-run/);
});
