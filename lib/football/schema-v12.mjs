// Read-path indexes (production 2026-11-27): opening a match ran
//   football_players ... OR p.id IN (SELECT entity_id FROM field_claims WHERE field='membership:<team>' AND valid_to IS NULL ...)
// twice per page; with no index leading on `field` that scanned all 737k claims and exceeded the 60 s statement
// timeout, so every match page returned 503 after ~70-80 s. Production applies this with CREATE INDEX CONCURRENTLY.
export const readPathMigration = [
  `CREATE INDEX IF NOT EXISTS idx_claims_open_field ON field_claims(field,entity_id) WHERE valid_to IS NULL`,
];
