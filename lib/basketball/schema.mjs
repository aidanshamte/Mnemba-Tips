// Basketball storage (additive). Pre-game predictions are immutable (created before tip-off).
export const basketballMigration=[
 `CREATE TABLE IF NOT EXISTS basketball_teams(id TEXT PRIMARY KEY,provider TEXT NOT NULL,external_id TEXT NOT NULL,league TEXT NOT NULL,name TEXT NOT NULL,abbreviation TEXT,city TEXT,conference TEXT,division TEXT,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS basketball_games(id TEXT PRIMARY KEY,provider TEXT NOT NULL,external_id TEXT NOT NULL,league TEXT NOT NULL,season INTEGER NOT NULL,starts_at INTEGER NOT NULL,status TEXT NOT NULL,period INTEGER,home_team_id TEXT NOT NULL,away_team_id TEXT NOT NULL,home_score INTEGER,away_score INTEGER,postseason INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_basketball_games_time ON basketball_games(starts_at)`,
 `CREATE INDEX IF NOT EXISTS idx_basketball_games_teams ON basketball_games(home_team_id,away_team_id)`,
 `CREATE TABLE IF NOT EXISTS basketball_predictions(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,model_version TEXT NOT NULL,created_at INTEGER NOT NULL,starts_at INTEGER NOT NULL,payload TEXT NOT NULL,CHECK(created_at<starts_at))`,
 `CREATE INDEX IF NOT EXISTS idx_basketball_predictions_game ON basketball_predictions(game_id)`,
 `CREATE TABLE IF NOT EXISTS basketball_grades(prediction_id TEXT PRIMARY KEY,game_id TEXT NOT NULL,settled_at INTEGER NOT NULL,payload TEXT NOT NULL)`
];
