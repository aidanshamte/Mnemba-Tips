export const recommendationMigration=[
 `CREATE TABLE IF NOT EXISTS recommendation_lists(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,published_at INTEGER NOT NULL,rule_version TEXT NOT NULL,payload TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_recommendation_scope ON recommendation_lists(scope_key,published_at)`,
 `CREATE TRIGGER IF NOT EXISTS immutable_recommendation_lists BEFORE UPDATE ON recommendation_lists BEGIN SELECT RAISE(ABORT,'Published shortlist is immutable'); END`,
 `CREATE TABLE IF NOT EXISTS recommendation_grades(id TEXT PRIMARY KEY,list_id TEXT NOT NULL REFERENCES recommendation_lists(id),fixture_id TEXT NOT NULL,recorded_at INTEGER NOT NULL,payload TEXT NOT NULL)`,
 `CREATE TRIGGER IF NOT EXISTS immutable_recommendation_grades BEFORE UPDATE ON recommendation_grades BEGIN SELECT RAISE(ABORT,'Recommendation grade audit is immutable'); END`
];
