import { createPool, postgresDatabase } from '../../lib/azure/postgres.mjs';
import { runScheduled, CRON_JOBS } from '../../lib/football/scheduled.mjs';
const cron = process.env.MNEMBA_JOB_CRON;
if (!Object.hasOwn(CRON_JOBS, cron)) throw new Error('MNEMBA_JOB_CRON must match a configured schedule');
// Staging cannot consume production provider quotas accidentally.
if (process.env.MNEMBA_ENABLE_UPDATES !== '1') throw new Error('Updates are disabled until migration verification and provider quota coordination');
const pool = createPool();
const client = await pool.connect();
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
} catch { console.error('Scheduled update failed; inspect protected cron_runs records'); process.exitCode = 1; }
finally { await client.query('SELECT pg_advisory_unlock(714025)'); client.release(); await pool.end(); }
