import { Store } from './store.mjs';
import { IntelligenceService } from './intelligence.mjs';

export const CRON_JOBS = Object.freeze({
  // Licensed-provider stages run last and are time-boxed, so they only use time the existing stages leave.
  '0 * * * *': ['fixtures', 'results', 'models', 'snapshots', 'media', 'fivedollar'],
  // Fresh, user-facing data first; the bulk historical expansion last so it cannot starve news and results.
  '20 */3 * * *': ['news', 'openligadb', 'video-news', 'media', 'badges', 'documents', 'priority-import', 'fivedollar-details'],
  '40 3 * * *': ['retention', 'reconcile', 'identities', 'competition-identities', 'search-index', 'calibration', 'rosters', 'media-news'],
});

// Cooperative deadline checks cover database operations as well as provider fetches.
// Do not race a still-running job against a timer and release its lease early.
export function boundedDatabase(db, check) {
  const wrap = statement => new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...args) => wrap(target.bind(...args));
    if (['run', 'all', 'first', 'raw'].includes(key)) return (...args) => { check(); return target[key](...args); };
    return Reflect.get(target, key);
  } });
  return { prepare(sql) { check(); return wrap(db.prepare(sql)); },
    batch(statements) { check(); return db.batch(statements); } };
}

export async function runScheduled(controller, env, options = {}) {
  const jobs = CRON_JOBS[controller.cron];
  if (!jobs) throw new Error('Unknown cron schedule');
  const now = options.now ?? Date.now;
  const store = new Store(env.DB, now);
  // Production schema is applied by versioned migrations before deployment.
  const owner = await store.lock('cloudflare-cron', 600000);
  if (!owner) return { state: 'skipped', reason: 'Another scheduled run holds the lease' };
  const id = `${controller.cron}:${controller.scheduledTime}`, started = now(), results = [];
  try {
    const prior = await store.one('SELECT id FROM cron_runs WHERE id=?', id);
    if (prior) return { state: 'skipped', reason: 'Event already recorded' };
    await store.run("UPDATE cron_runs SET state='interrupted',finished_at=? WHERE state='running' AND started_at<?", started, started - 600000);
    await store.upsert('cron_runs', { id, cron: controller.cron, scheduled_at: controller.scheduledTime, started_at: started, finished_at: null, state: 'running', payload: '[]' });
    const deadline = started + (options.timeoutMs ?? 240000);
    const check = () => { if (now() >= deadline) throw new Error('Scheduled run deadline exceeded'); };
    const leaseRetries = options.leaseRetries ?? 8, leaseWaitMs = options.leaseWaitMs ?? 5000;
    const leaseWait = options.leaseWait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const boundedStore = new Store(boundedDatabase(env.DB, check), now);
    const service = options.service ?? new IntelligenceService(boundedStore, env, {
      fetcher: (url, init = {}) => {
        check();
        return fetch(url, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - now()))]) });
      },
      sleep: async ms => { check(); if (now() + ms >= deadline) throw new Error('Retry deferred beyond deadline'); await new Promise(resolve => setTimeout(resolve, ms)); check(); },
    });
    await service.initialize();
    // Long-running stages (models) stop between items before this point, persist progress and still grade.
    service.stageDeadline = deadline - (options.stageReserveMs ?? 120000);
    service.runDeadline = deadline;
    for (const job of jobs) {
      try {
        check();
        const previous = await store.one('SELECT next_run FROM update_jobs WHERE id=?', job);
        if (previous?.next_run > now()) { results.push({ job, state: 'not-due' }); continue; }
        let result = await service.sync(job);
        // Live workers hold the shared football-sync lease for a few seconds every minute. Wait out brief
        // contention instead of abandoning every remaining job in this run (bounded by the run deadline).
        for (let attempt = 0; result.skipped === 'Another synchronization is running' && attempt < leaseRetries && now() + leaseWaitMs < deadline - 30000; attempt++) {
          await leaseWait(leaseWaitMs); check(); result = await service.sync(job);
        }
        if(job==='models'&&result.complete===false){
          const pages=[result];
          while(result.complete===false&&!result.stoppedEarly&&pages.length<6&&now()<deadline-30000){check();result=await service.sync(job);pages.push(result);}
          result={...result,pages,processed:pages.reduce((n,p)=>n+(p.processed??0),0)};
        }
        const deferred = typeof result.skipped === 'string' || result.skipped === true;
        results.push({ job, state: deferred ? 'deferred' : result.outcome ?? 'success', result });
        await store.run('UPDATE cron_runs SET payload=? WHERE id=?', JSON.stringify(results), id);
        if (deferred) break;
      } catch (error) {
        results.push({ job, state: 'error', error: error.message });
        // The service's guarded cleanup may have hit the deadline. Preserve its
        // football-sync lease until expiry; do not unlock another owner's job.
        if (now() >= deadline) break;
      }
    }
    const state = results.some(r => ['error', 'partial', 'empty', 'deferred', 'degraded'].includes(r.state)) ? 'partial' : 'success';
    await store.run('UPDATE cron_runs SET state=?,finished_at=?,payload=? WHERE id=?', state, now(), JSON.stringify(results), id);
    console.log('mnemba_cron', JSON.stringify({ id, state, jobs: results.map(({job,state}) => ({job,state})) }));
    return { state, results };
  } catch (error) {
    await store.run("UPDATE cron_runs SET state='error',finished_at=?,payload=? WHERE id=?", now(), JSON.stringify({error:error.message,results}), id);
    throw error;
  } finally { await store.unlock('cloudflare-cron', owner); }
}
