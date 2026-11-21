// Canonical competition identity: load evidence, plan (pure), and apply (idempotent, additive, auditable).
// Apply never deletes provider rows or evidence. It records one canonical_entities row per canonical
// competition, points each provider competition's entity_aliases row at it (verified, with the evidence
// basis) and queues uncertain merges in verification_queue. Re-running with the same data changes nothing.
import {planCompetitionIdentities, resolveCompetition} from './competition-identity.mjs';

export async function loadCompetitionEvidence(store) {
  const competitions = (await store.all('SELECT id,provider,external_id,name,type,payload FROM competitions')).map(r => {
    const p = JSON.parse(r.payload); return {id: r.id, provider: r.provider, externalId: r.external_id, name: r.name, type: r.type ?? p.type ?? null, country: p.country ?? null, gender: p.gender ?? null};
  });
  const fixtures = (await store.all('SELECT f.competition_id,f.starts_at,h.name home,a.name away FROM fixtures f JOIN football_teams h ON h.id=f.home_team_id JOIN football_teams a ON a.id=f.away_team_id'))
    .map(r => ({competitionId: r.competition_id, startsAt: Number(r.starts_at), home: r.home, away: r.away}));
  return {competitions, fixtures};
}

export async function planIdentities(store) {
  const {competitions, fixtures} = await loadCompetitionEvidence(store);
  return planCompetitionIdentities(competitions, fixtures);
}

export const EVIDENCE_URL = 'https://aidanshamte.me/football/coverage#competition-identity';

export async function applyIdentities(store, plan, {now = store.now()} = {}) {
  const statements = [], changed = {canonical: 0, aliases: 0, queued: 0};
  const existing = new Map((await store.all("SELECT id,payload FROM canonical_entities WHERE kind='competition' AND id LIKE 'competition:%'")).map(r => [r.id, r.payload]));
  for (const g of plan.groups) {
    const payload = JSON.stringify({...g, identityVersion: 1});
    if (existing.get(g.canonicalId) === payload) continue;
    statements.push(['INSERT INTO canonical_entities(id,kind,name,wikidata_id,country,gender,payload,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country=excluded.country,gender=excluded.gender,payload=excluded.payload,updated_at=excluded.updated_at',
      g.canonicalId, 'competition', g.name, null, g.country ?? g.governingBody ?? null, g.gender, payload, now]);
    changed.canonical++;
  }
  const aliases = new Map((await store.all("SELECT provider_id,canonical_id,verified FROM entity_aliases WHERE provider_id IN (SELECT id FROM competitions)")).map(r => [r.provider_id, r]));
  for (const m of plan.memberships) {
    const prior = aliases.get(m.providerId);
    if (prior?.canonical_id === m.canonicalId) continue;
    if (prior) {
      statements.push(['UPDATE entity_aliases SET canonical_id=?,verified=1,source_url=? WHERE provider_id=?', m.canonicalId, EVIDENCE_URL, m.providerId]);
      // Keep fixture identities pointing at the same canonical competition.
      statements.push(['UPDATE fixture_identities SET competition_canonical=? WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id=?)', m.canonicalId, m.providerId]);
    } else {
      const provider = m.providerId.split(':')[0];
      statements.push(['INSERT INTO entity_aliases(id,canonical_id,provider,provider_id,alias,normalized_alias,verified,source_url) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        `alias:${m.providerId}`, m.canonicalId, provider, m.providerId, m.providerId, m.providerId.toLowerCase(), 1, EVIDENCE_URL]);
    }
    changed.aliases++;
  }
  const queued = new Map((await store.all("SELECT id,payload FROM verification_queue WHERE id LIKE 'identity:%'")).map(q => [q.id, q.payload]));
  for (const r of plan.reviews) {
    const id = `identity:${r.kind}:${r.providerId}`;
    if (queued.get(id) === JSON.stringify(r)) continue;
    statements.push(['INSERT INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      id, r.kind, r.providerId, EVIDENCE_URL, JSON.stringify(r), 'pending', now]);
    changed.queued++;
  }
  if (statements.length) await store.batch(statements);
  return changed;
}

/**
 * Public catalog: one entry per canonical competition. Cross-provider grouping comes only from the persisted,
 * evidence-checked mapping (entity_aliases → competition:*). Unmapped records fall back to the pure resolver but
 * group only with the same provider (stage/group/season records), never across providers by name.
 */
/** "2026-27", "2026/2027" and "2026/27" are the same season label. */
export const seasonLabel = value => { const m = String(value).match(/^((?:19|20)\d{2})\s*[/-]\s*(?:(?:19|20)?(\d{2}))$/); return m ? `${m[1]}/${m[2]}` : String(value); };
const GATED_PROVIDERS = new Set(['fivedollar']);
export async function catalogCompetitions(store, now = store.now()) {
  const rows = await store.all(`SELECT c.id,c.provider,c.external_id,c.name,c.type,c.payload,COUNT(f.id) fixture_rows,
    MIN(CASE WHEN f.starts_at>? THEN f.starts_at END) next_at, MAX(CASE WHEN f.starts_at<=? AND f.status IN ('FT','AET','PEN','FINISHED') THEN f.starts_at END) last_result_at
    FROM competitions c JOIN fixtures f ON f.competition_id=c.id GROUP BY c.id,c.provider,c.external_id,c.name,c.type,c.payload`, now, now);
  const mapped = new Map((await store.all("SELECT provider_id,canonical_id FROM entity_aliases WHERE verified=1 AND canonical_id LIKE 'competition:%'")).map(r => [r.provider_id, r.canonical_id]));
  const canon = new Map((await store.all("SELECT id,payload FROM canonical_entities WHERE kind='competition' AND id LIKE 'competition:%'")).map(r => [r.id, JSON.parse(r.payload)]));
  // Licensed-provider records reach the public catalog only once the identity task has mapped them and no review is open.
  const reviewRows = await store.all("SELECT entity_id,kind FROM verification_queue WHERE id LIKE 'identity:%' AND status='pending'");
  const pending = new Set(reviewRows.filter(r => r.kind !== 'competition-possible-duplicate').map(r => r.entity_id));
  const possibleDuplicate = new Set(reviewRows.filter(r => r.kind === 'competition-possible-duplicate').map(r => r.entity_id));
  const groups = new Map();
  for (const r of rows) {
    // Any provider record with an open identity review stays private; licensed-provider records also need a mapping.
    if (pending.has(r.id) || (GATED_PROVIDERS.has(r.provider) && (!mapped.has(r.id) || possibleDuplicate.has(r.id)))) continue;
    const payload = JSON.parse(r.payload), record = {id: r.id, provider: r.provider, externalId: r.external_id, name: r.name, type: r.type ?? payload.type ?? null, country: payload.country ?? null, gender: payload.gender ?? null};
    const identity = resolveCompetition(record), persisted = mapped.get(r.id);
    const key = persisted ?? `${identity.canonicalId}|${r.provider}`, summary = persisted ? canon.get(persisted) : null;
    if (!groups.has(key)) groups.set(key, {
      id: persisted ?? identity.canonicalId, canonical: !!persisted, name: summary?.name ?? identity.name, country: {name: summary?.country ?? identity.country ?? null, continent: summary?.continent ?? identity.continent ?? null},
      governingBody: summary?.governingBody ?? identity.governingBody, type: summary?.type ?? identity.type, tier: summary?.tier ?? identity.tier, gender: summary?.gender ?? identity.gender, age: summary?.age ?? identity.age,
      scope: (summary?.scopeKind ?? identity.scopeKind) === 'country' ? 'domestic' : 'international', providerIds: [], emblemId: r.id, seasons: new Set(summary?.seasons ?? []), stages: summary?.stages ?? [],
      fixtureRows: 0, distinctFixtures: summary?.distinctFixtures ?? null, plannedRows: summary?.providerRows ?? null, teamCount: summary?.distinctTeams ?? null, nextFixtureAt: null, latestResultAt: null, featured: payload.featured ?? null,
    });
    const g = groups.get(key);
    g.providerIds.push(r.id); g.fixtureRows += Number(r.fixture_rows);
    if (identity.season) g.seasons.add(seasonLabel(identity.season));
    for (const s of payload.seasons ?? []) if (s?.label || s?.year) g.seasons.add(seasonLabel(s.label ?? s.year));
    if (r.next_at != null && (g.nextFixtureAt == null || Number(r.next_at) < g.nextFixtureAt)) g.nextFixtureAt = Number(r.next_at);
    if (r.last_result_at != null && (g.latestResultAt == null || Number(r.last_result_at) > g.latestResultAt)) g.latestResultAt = Number(r.last_result_at);
  }
  return [...groups.values()].map(g => {
    // Distinct matches from the last identity plan, plus provider rows that arrived since (upper bound until the next plan).
    const seasons = [...g.seasons].sort(), fixtureCount = g.distinctFixtures == null ? g.fixtureRows : g.distinctFixtures + Math.max(0, g.fixtureRows - (g.plannedRows ?? g.fixtureRows));
    // Coverage describes recorded data only; it is not a claim about the competition's real schedule.
    const coverage = fixtureCount >= 200 ? 'extensive' : fixtureCount >= 40 ? 'partial' : 'limited';
    const rest = {...g}; delete rest.plannedRows; delete rest.distinctFixtures;
    return {...rest, seasons, currentSeason: seasons.at(-1) ?? null, fixtureCount, coverage, active: g.nextFixtureAt != null || (g.latestResultAt != null && now - g.latestResultAt < 60 * 86400000)};
  }).sort((a, b) => a.name.localeCompare(b.name) || (a.country.name ?? '').localeCompare(b.country.name ?? ''));
}
