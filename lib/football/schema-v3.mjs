export const searchMigration=[
 `CREATE TABLE IF NOT EXISTS verified_entity_aliases (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, source_url TEXT NOT NULL, license_ref TEXT NOT NULL, verified_at INTEGER NOT NULL, UNIQUE(provider_id,normalized_alias))`,
 `CREATE INDEX IF NOT EXISTS idx_verified_alias_name ON verified_entity_aliases(normalized_alias)`,
 `CREATE TABLE IF NOT EXISTS search_documents (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, normalized TEXT NOT NULL, payload TEXT NOT NULL, revision TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_search_kind_name ON search_documents(kind,normalized)`,
 `CREATE TABLE IF NOT EXISTS search_words (word TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES search_documents(id) ON DELETE CASCADE, PRIMARY KEY(word,document_id))`,
 `CREATE INDEX IF NOT EXISTS idx_search_words_document ON search_words(document_id)`,
];
