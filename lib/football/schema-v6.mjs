export const lifecycleMigration=[
 `CREATE TABLE IF NOT EXISTS analysis_grade_audit (id TEXT PRIMARY KEY,forecast_id TEXT NOT NULL REFERENCES analysis_forecasts(id),fixture_id TEXT NOT NULL,recorded_at INTEGER NOT NULL,state TEXT NOT NULL,revision TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(forecast_id,revision))`,
 `CREATE INDEX IF NOT EXISTS idx_grade_audit_forecast ON analysis_grade_audit(forecast_id,recorded_at)`,
 `CREATE TRIGGER IF NOT EXISTS immutable_grade_audit BEFORE UPDATE ON analysis_grade_audit BEGIN SELECT RAISE(ABORT,'Grade audit is immutable'); END`,
 `CREATE TABLE IF NOT EXISTS analysis_batches (id TEXT PRIMARY KEY,window_start INTEGER NOT NULL,window_end INTEGER NOT NULL,cursor_time INTEGER NOT NULL,cursor_id TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS analysis_processing (batch_id TEXT NOT NULL,fixture_id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,attempted_at INTEGER NOT NULL,PRIMARY KEY(batch_id,fixture_id))`,
 `CREATE TABLE IF NOT EXISTS model_parameter_versions (id TEXT PRIMARY KEY,model_version TEXT NOT NULL,trained_at INTEGER NOT NULL,payload TEXT NOT NULL)`,
 `CREATE TRIGGER IF NOT EXISTS immutable_parameter_versions BEFORE UPDATE ON model_parameter_versions BEGIN SELECT RAISE(ABORT,'Model parameters are immutable'); END`,
 `CREATE TABLE IF NOT EXISTS model_release_decisions (id TEXT PRIMARY KEY,model_version TEXT NOT NULL,parameter_id TEXT,created_at INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS model_runtime (id TEXT PRIMARY KEY,model_version TEXT NOT NULL,parameter_id TEXT,updated_at INTEGER NOT NULL)`,
];
