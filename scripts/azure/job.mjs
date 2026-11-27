import { createPool, postgresDatabase, describeError } from '../../lib/azure/postgres.mjs';
import { runScheduled, CRON_JOBS } from '../../lib/football/scheduled.mjs';
const cron = process.env.MNEMBA_JOB_CRON;
if (!Object.hasOwn(CRON_JOBS, cron)) throw new Error('MNEMBA_JOB_CRON must match a configured schedule');
// Staging cannot consume production provider quotas accidentally.
if (process.env.MNEMBA_ENABLE_UPDATES !== '1') throw new Error('Updates are disabled until migration verification and provider quota coordination');
const pool = createPool();
const client = await pool.connect();
// The lock session can be terminated by the server; record it instead of crashing with an unhandled 'error' event.
client.on('error', error => console.error('mnemba_pg_session_error', describeError(error)));
try {
  // Session advisory lock covers executions longer than the existing D1 lease.
  const { rows } = await client.query('SELECT pg_try_advisory_lock(714025) AS locked');
  if (!rows[0].locked) console.log('Another scheduled update is running');
  else {
    const now = Date.now();
    const result = await runScheduled({ cron, scheduledTime: Math.floor(now / 60000) * 60000 },
      { ...process.env, MNEMBA_SCHEMA_MANAGED: '1', DB: postgresDatabase(pool) });
    if (!['success', 'skipped'].includes(result.state)) process.exitCode = 1;
  }
} catch (error) { console.error('Scheduled update failed; inspect protected cron_runs records', describeError(error), String(error?.message ?? '').replace(/postgres(ql)?:\/\/\S+/gi, '[connection]').slice(0, 160)); process.exitCode = 1; }
finally {
  // A terminated session already released its advisory lock; do not turn cleanup into a second failure.
  try { await client.query('SELECT pg_advisory_unlock(714025)'); } catch (error) { console.error('mnemba_pg_unlock_skipped', describeError(error)); }
  client.release(); await pool.end().catch(() => {});
}
