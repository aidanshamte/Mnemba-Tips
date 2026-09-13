export const cronMigration = [
  `CREATE TABLE IF NOT EXISTS cron_runs(id TEXT PRIMARY KEY,cron TEXT NOT NULL,scheduled_at INTEGER NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,state TEXT NOT NULL,payload TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_cron_runs_time ON cron_runs(scheduled_at)`
];
