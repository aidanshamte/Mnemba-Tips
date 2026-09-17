CREATE TABLE IF NOT EXISTS media_assets(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,source_url TEXT NOT NULL,usage_basis TEXT NOT NULL,attribution TEXT NOT NULL,verified_at INTEGER NOT NULL,last_success INTEGER,width INTEGER,height INTEGER,state TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entity_media(entity_id TEXT NOT NULL,entity_type TEXT NOT NULL,media_type TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES media_assets(id),is_primary INTEGER NOT NULL DEFAULT 1,identity_basis TEXT NOT NULL,PRIMARY KEY(entity_id,media_type,asset_id));
CREATE INDEX IF NOT EXISTS idx_entity_media_lookup ON entity_media(entity_id,media_type,is_primary);
CREATE TABLE IF NOT EXISTS media_enrichment(entity_id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,state TEXT NOT NULL,next_attempt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_media_enrichment_due ON media_enrichment(next_attempt,state);
CREATE TABLE IF NOT EXISTS media_url_checks(url TEXT PRIMARY KEY,state TEXT NOT NULL,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL,payload TEXT NOT NULL);
