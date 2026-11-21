import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {runScheduled} from '../../lib/football/scheduled.mjs';

// Outcome vocabulary for update_jobs.state and cron_runs:
//   success  – sources answered and useful records were persisted or confirmed
//   empty    – every attempted source answered successfully but returned no records
//   degraded – provider errors/rejected records, or coverage-health concerns with data present
//   partial  – non-fixture job with some source errors
//   error    – the job itself threw
// Scheduler-only: deferred (football-sync lease held), skipped (cron lease held or event already run).
const NOW = Date.parse('2026-09-24T10:00:00Z');
const day = offset => new Date(NOW + offset * 86400000).toISOString().slice(0, 10);
const event = (id, d) => ({idEvent: String(id), idHomeTeam: `${id}1`, idAwayTeam: `${id}2`, idLeague: '5076', strLeague: 'Synthetic League', strSport: 'Soccer', strHomeTeam: `Home ${id}`, strAwayTeam: `Away ${id}`, strSeason: '2026', dateEvent: d, strTimestamp: `${d}T18:00:00`, strStatus: 'NS', intHomeScore: null, intAwayScore: null});
// fetcher(dayString) -> {events} | {events:'invalid'} (adapter rejects the response as a provider error)
async function setup(byDay) {
  const x = database(); x.store.now = () => NOW; await x.store.init();
  x.service = new IntelligenceService(x.store, {}, {sleep: async () => {}, fetcher: async url => {
    const d = new URL(url).searchParams.get('d');
    return Response.json(byDay(d));
  }});
  await x.service.initialize();
  return x;
}
const job = store => store.one("SELECT state,error,last_success,next_run FROM update_jobs WHERE id='fixtures'");

test('legitimate empty provider responses are recorded as empty, not success or degraded', async () => {
  const {service, store, sqlite} = await setup(() => ({events: []}));
  try {
    const result = await service.sync('fixtures');
    assert.equal(result.outcome, 'empty');
    assert.equal(result.fixtures, 0);
    assert.equal(result.counts.sourceErrors, 0);
    assert.equal(result.health.state, 'degraded', 'coverage health still reports the gap');
    const row = await job(store);
    assert.equal(row.state, 'empty');
    assert.equal(row.error, 'No valid fixtures returned by configured sources');
    assert.equal(row.last_success, null);
    assert.equal(row.next_run, NOW + 1800000, 'normal cadence; no accelerated retry');
  } finally { sqlite.close(); }
});

test('partial provider success with some failed requests is degraded and keeps persisted fixtures', async () => {
  const {service, store, sqlite} = await setup(d => d === day(0) ? {events: [event(901, d)]} : d === day(1) ? {events: 'invalid'} : {events: []});
  try {
    const result = await service.sync('fixtures');
    assert.equal(result.outcome, 'degraded');
    assert.ok(result.fixtures >= 1);
    assert.equal(result.health.errors.length, 1);
    assert.match(result.health.errors[0], /Invalid TheSportsDB fixture response/);
    assert.equal((await store.one('SELECT COUNT(*) n FROM fixtures')).n, 1);
    const row = await job(store);
    assert.equal(row.state, 'degraded');
    assert.match(row.error, /Provider errors or rejected records/);
    assert.equal(row.last_success, null, 'degraded runs never count as a clean success');
  } finally { sqlite.close(); }
});

test('complete provider failure is degraded, never empty', async () => {
  const {service, store, sqlite} = await setup(() => ({events: 'invalid'}));
  try {
    const result = await service.sync('fixtures');
    assert.equal(result.outcome, 'degraded');
    assert.equal(result.fixtures, 0);
    assert.equal(result.health.errors.length, 7);
    assert.equal(result.counts.sourceErrors, 7);
    const row = await job(store);
    assert.equal(row.state, 'degraded');
    assert.match(row.error, /Provider errors or rejected records/);
    assert.match(row.error, /No fixtures accepted or confirmed unchanged/);
  } finally { sqlite.close(); }
});

test('stored status: success sets last_success; empty and degraded runs preserve it', async () => {
  const {service, store, sqlite} = await setup(() => ({events: []}));
  try {
    const ok = await service.sync('search-index');
    assert.equal(ok.outcome, 'success');
    assert.equal((await store.one("SELECT state,last_success FROM update_jobs WHERE id='search-index'")).last_success, NOW);
    await store.upsert('update_jobs', {id: 'fixtures', interval_ms: 1800000, last_attempt: NOW - 3600000, last_success: NOW - 3600000, next_run: NOW - 1, state: 'success', error: null, payload: '{}'});
    const empty = await service.sync('fixtures');
    assert.equal(empty.outcome, 'empty');
    const row = await job(store);
    assert.equal(row.state, 'empty');
    assert.equal(row.last_success, NOW - 3600000, 'previous success time preserved');
  } finally { sqlite.close(); }
});

test('football-sync lease held throughout: sync defers, scheduler retries, records deferred and stops later jobs', async () => {
  const {service, store, sqlite, db} = await setup(() => ({events: []}));
  try {
    const holder = await store.lock('football-sync', 600000);
    assert.ok(holder);
    const direct = await service.sync('fixtures');
    assert.equal(direct.skipped, 'Another synchronization is running');
    assert.equal(await job(store), null, 'a deferred sync never writes update_jobs');
    let waits = 0;
    const run = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service, leaseWait: async () => { waits++; }});
    assert.equal(waits, 8, 'bounded retries before deferring');
    assert.deepEqual(run.results.map(r => [r.job, r.state]), [['fixtures', 'deferred']]);
    assert.equal(run.state, 'partial');
    assert.equal((await store.one('SELECT state FROM cron_runs WHERE scheduled_at=?', NOW)).state, 'partial');
  } finally { sqlite.close(); }
});

test('brief football-sync contention (live worker tick) is waited out and later jobs still run', async () => {
  const {service, store, sqlite, db} = await setup(() => ({events: []}));
  try {
    const holder = await store.lock('football-sync', 600000);
    let waits = 0;
    const run = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service,
      leaseWait: async () => { waits++; if (waits === 1) await store.unlock('football-sync', holder); }});
    assert.equal(waits, 1);
    assert.notEqual(run.results[0].state, 'deferred');
    assert.equal(run.results[0].job, 'fixtures');
    assert.ok(run.results.length > 1, 'remaining jobs ran after the lease was released');
    assert.ok(!run.results.some(r => r.state === 'deferred'));
  } finally { sqlite.close(); }
});

test('scheduler continues after empty and degraded jobs and reports the run as partial', async () => {
  const {store, sqlite, db} = await setup(() => ({events: []}));
  try {
    const outcomes = {fixtures: 'empty', results: 'degraded', models: 'success', snapshots: 'success', media: 'success'};
    const calls = [];
    const service = {initialize: async () => {}, sync: async j => { calls.push(j); return {outcome: outcomes[j], complete: true}; }};
    const run = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service});
    assert.deepEqual(calls, ['fixtures', 'results', 'models', 'snapshots', 'media', 'fivedollar']);
    assert.deepEqual(run.results.map(r => r.state), ['empty', 'degraded', 'success', 'success', 'success', 'success']);
    assert.equal(run.state, 'partial');
    const all = await runScheduled({cron: '0 * * * *', scheduledTime: NOW + 3600000}, {DB: db}, {now: () => NOW, service: {initialize: async () => {}, sync: async () => ({outcome: 'success', complete: true})}});
    assert.equal(all.state, 'success');
  } finally { sqlite.close(); }
});

test('scheduler skips when the cron lease is held or the event already ran', async () => {
  const {store, sqlite, db} = await setup(() => ({events: []}));
  try {
    const service = {initialize: async () => {}, sync: async () => ({outcome: 'success', complete: true})};
    const lease = await store.lock('cloudflare-cron', 600000);
    const blocked = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service});
    assert.deepEqual(blocked, {state: 'skipped', reason: 'Another scheduled run holds the lease'});
    await store.unlock('cloudflare-cron', lease);
    const first = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service});
    assert.equal(first.state, 'success');
    const repeat = await runScheduled({cron: '0 * * * *', scheduledTime: NOW}, {DB: db}, {now: () => NOW, service});
    assert.deepEqual(repeat, {state: 'skipped', reason: 'Event already recorded'});
  } finally { sqlite.close(); }
});
