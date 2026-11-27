-- Read-path index (production 2026-11-27): match pages scanned every field_claims row for roster membership.
-- Production PostgreSQL: CREATE INDEX CONCURRENTLY idx_claims_open_field ON field_claims(field,entity_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_open_field ON field_claims(field,entity_id) WHERE valid_to IS NULL;
