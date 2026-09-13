export const estimateMigration=[
 `CREATE TABLE IF NOT EXISTS exploratory_estimates (id TEXT PRIMARY KEY,fixture_id TEXT NOT NULL REFERENCES fixtures(id),as_of INTEGER NOT NULL,revision TEXT NOT NULL,payload TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_exploratory_fixture ON exploratory_estimates(fixture_id,as_of DESC)`,
 `CREATE TRIGGER IF NOT EXISTS exploratory_estimates_immutable BEFORE UPDATE ON exploratory_estimates BEGIN SELECT RAISE(ABORT,'Exploratory estimates are immutable'); END`,
];
