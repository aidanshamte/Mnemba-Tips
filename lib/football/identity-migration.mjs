// Canonical competition identity: load evidence, plan (pure), and apply (idempotent, additive, auditable).
// Apply never deletes provider rows or evidence. It records one canonical_entities row per canonical
// competition, points each provider competition's entity_aliases row at it (verified, with the evidence
// basis) and queues uncertain merges in verification_queue. Re-running with the same data changes nothing.
import {planCompetitionIdentities} from './competition-identity.mjs';

export async function loadCompetitionEvidence(store) {
  const competitions = (await store.all('SELECT id,provider,external_id,name,type,payload FROM competitions')).map(r => {
    const p = JSON.parse(r.payload); return {id: r.id, provider: r.provider, externalId: r.external_id, name: r.name, type: r.type ?? p.type ?? null, country: p.country ?? null, gender: p.gender ?? null};
  });
  const fixtures = (await store.all('SELECT f.competition_id,f.starts_at,h.name home,a.name away FROM fixtures f JOIN football_teams h ON h.id=f.home_team_id JOIN football_teams a ON a.id=f.away_team_id'))
    .map(r => ({competitionId: r.competition_id, startsAt: Number(r.starts_at), home: r.home, away: r.away}));
  return {competitions: competitions.filter(c => fixtures.some(f => f.competitionId === c.id) || true), fixtures};
}

export async function planIdentities(store) {
  const {competitions, fixtures} = await loadCompetitionEvidence(store);
  return planCompetitionIdentities(competitions, fixtures);
}

const EVIDENCE_URL = 'https://aidanshamte.me/football/coverage#competition-identity';

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
  for (const r of plan.reviews) {
    const id = `identity:${r.kind}:${r.providerId}`;
    statements.push(['INSERT INTO verification_queue(id,kind,entity_id,source_url,payload,status,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      id, r.kind, r.providerId, EVIDENCE_URL, JSON.stringify(r), 'pending', now]);
    changed.queued++;
  }
  if (statements.length) await store.batch(statements);
  return changed;
}
