export const forecastMigration=[
 `CREATE TABLE IF NOT EXISTS analysis_forecasts (id TEXT PRIMARY KEY, fixture_id TEXT NOT NULL REFERENCES fixtures(id), model_version TEXT NOT NULL, as_of INTEGER NOT NULL, kickoff_at INTEGER NOT NULL, max_known_at INTEGER NOT NULL, training_allowed INTEGER NOT NULL, payload TEXT NOT NULL, evidence_ids TEXT NOT NULL, CHECK(as_of<kickoff_at), CHECK(max_known_at<=as_of), UNIQUE(fixture_id,model_version,as_of))`,
 `CREATE TRIGGER IF NOT EXISTS immutable_analysis_forecasts_update BEFORE UPDATE ON analysis_forecasts BEGIN SELECT RAISE(ABORT,'Forecasts are immutable'); END`,
 `CREATE TRIGGER IF NOT EXISTS immutable_analysis_forecasts_delete BEFORE DELETE ON analysis_forecasts BEGIN SELECT RAISE(ABORT,'Forecasts are immutable'); END`,
 `CREATE TABLE IF NOT EXISTS analysis_grades (id TEXT PRIMARY KEY REFERENCES analysis_forecasts(id), fixture_id TEXT NOT NULL REFERENCES fixtures(id), result_known_at INTEGER NOT NULL, outcome INTEGER NOT NULL CHECK(outcome IN (0,1,2)), payload TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_analysis_forecasts_fixture ON analysis_forecasts(fixture_id,as_of)`,
 `CREATE TABLE IF NOT EXISTS model_parameters (id TEXT PRIMARY KEY, model_version TEXT NOT NULL, trained_at INTEGER NOT NULL, training_cutoff INTEGER NOT NULL, payload TEXT NOT NULL)`,
];
