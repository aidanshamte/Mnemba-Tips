CREATE TABLE IF NOT EXISTS live_snapshots(id TEXT PRIMARY KEY,fixture_id TEXT NOT NULL,canonical_id TEXT,model_version TEXT NOT NULL,created_at INTEGER NOT NULL,observed_at INTEGER,minute INTEGER,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_fixture ON live_snapshots(fixture_id,created_at);
CREATE TABLE IF NOT EXISTS live_grades(snapshot_id TEXT PRIMARY KEY,fixture_id TEXT NOT NULL,state TEXT NOT NULL,settled_at INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_live_grades_fixture ON live_grades(fixture_id);
