// Cross-provider team identity from linked fixtures.
//
// Production 2026-11-21: all 7,043 team records were their own canonical team, so a 5DollarFootballAPI "Augsburg" could
// not inherit the verified crest of the same club's LiveScore record (60 of 1,304 provider teams had one). The strongest
// lawful evidence is already stored: fixtures linked across providers (kickoff within 15 minutes and both teams
// compatible). Teams occupying the same side of the same linked matches, with compatible gender, age and reserve
// markers, are the same club. Never by name alone; one-to-one per provider; conflicts go to review; prior identities are
// logged so every change can be reversed.
import {linkFdfaFixtures, sameTeam, FDFA_SOURCE} from './fivedollar.mjs';

export const TEAM_EVIDENCE_URL = 'https://aidanshamte.me/football/coverage#team-identity';
const PROVIDER_ORDER = ['livescore', 'thesportsdb', 'openligadb', 'openfootball', 'statsbomb', 'football-data', 'api-football', FDFA_SOURCE];
const markers = s => (String(s ?? '').toLowerCase().match(/\b(women|w|u\d{2}|ii|iii|b|reserves?|youth|academy|femenil|frauen|feminino|femenino)\b/g) ?? []).sort().join(',');

/** Pure: team groups from linked-fixture rows [{canonical_id, provider, h, a, hn, an}]. */
export function planTeamIdentities(rows, {minLinksWithoutNameMatch = 2} = {}) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.canonical_id)) groups.set(r.canonical_id, []); groups.get(r.canonical_id).push(r); }
  const pairs = new Map(), names = new Map();
  const add = (x, xn, y, yn) => { if (x === y) return; const k = x < y ? `${x}|${y}` : `${y}|${x}`; pairs.set(k, (pairs.get(k) ?? 0) + 1); names.set(x, xn); names.set(y, yn); };
  for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    if (g[i].provider === g[j].provider) continue;
    add(g[i].h, g[i].hn, g[j].h, g[j].hn); add(g[i].a, g[i].an, g[j].a, g[j].an);
  }
  const accepted = [], rejected = [];
  for (const [k, n] of pairs) {
    const [x, y] = k.split('|'), a = names.get(x), b = names.get(y);
    const ok = markers(a) === markers(b) && (sameTeam(a, b) || n >= minLinksWithoutNameMatch);
    (ok ? accepted : rejected).push({x, y, links: n});
  }
  // Union-find over accepted pairs; a component with two records of one provider is a conflict (review, no merge).
  const parent = new Map(), find = v => { while (parent.get(v) !== v) { parent.set(v, parent.get(parent.get(v))); v = parent.get(v); } return v; };
  for (const {x, y} of accepted) { for (const v of [x, y]) if (!parent.has(v)) parent.set(v, v); parent.set(find(x), find(y)); }
  const components = new Map(); for (const v of parent.keys()) { const r = find(v); if (!components.has(r)) components.set(r, []); components.get(r).push(v); }
  const merges = [], conflicts = [];
  for (const members of components.values()) {
    const providers = members.map(m => m.split(':')[0]);
    if (new Set(providers).size !== providers.length) { conflicts.push({members, names: members.map(m => names.get(m)), reason: 'two records of one provider in one linked group'}); continue; }
    merges.push({members: members.sort((p, q) => PROVIDER_ORDER.indexOf(p.split(':')[0]) - PROVIDER_ORDER.indexOf(q.split(':')[0]) || p.localeCompare(q)), names: members.map(m => names.get(m))});
  }
  return {pairs: pairs.size, accepted: accepted.length, rejected, merges, conflicts};
}

/** Link historical provider fixtures that are still unlinked (resumable cursor, time-boxed). */
export async function linkHistoricalFixtures(service, {stopAt = Infinity, batch = 300} = {}) {
  const s = service.store, cursorKey = 'team-identity:link-cursor', saved = await s.cache(cursorKey);
  // A completed pass (or an expired cursor) restarts from now; otherwise continue back through history.
  const cursor = saved && !saved.stale && Number.isFinite(saved.data?.before) ? saved.data.before : s.now();
  const out = {checked: 0, linked: 0, alreadyLinked: 0, ambiguous: 0, unmatched: 0, cursor: null};
  const rows = await s.all(`SELECT f.payload FROM fixtures f JOIN fixture_identities i ON i.fixture_id=f.id WHERE f.provider=? AND f.starts_at<? AND f.starts_at>?
    AND NOT EXISTS (SELECT 1 FROM fixture_identities j WHERE j.canonical_id=i.canonical_id AND j.fixture_id<>i.fixture_id) ORDER BY f.starts_at DESC LIMIT ?`, FDFA_SOURCE, cursor, s.now() - 400 * 86400000, batch);
  const fixtures = rows.map(r => JSON.parse(r.payload));
  for (let i = 0; i < fixtures.length; i += 25) {
    if (s.now() >= stopAt) break;
    const chunk = fixtures.slice(i, i + 25), r = await linkFdfaFixtures(service, chunk);
    for (const k of ['linked', 'alreadyLinked', 'ambiguous', 'unmatched']) out[k] += r[k];
    out.checked += chunk.length; out.cursor = chunk.at(-1).startsAt;
  }
  const passComplete = out.checked === fixtures.length && fixtures.length < batch;
  // Mid-pass: remember where to continue. Pass complete: expire after a day, then restart from the newest fixtures.
  if (passComplete) await s.putCache(cursorKey, {before: 0, completedAt: s.now()}, 86400000);
  else if (out.cursor != null) await s.putCache(cursorKey, {before: out.cursor}, 30 * 86400000);
  return out;
}

/** Apply merges: point every member at the anchor's canonical team. Verified identities from other sources are never overridden. */
export async function applyTeamIdentities(service, plan) {
  const s = service.store, changed = {merged: 0, unchanged: 0, protected: 0, queued: 0};
  const ids = [...new Set(plan.merges.flatMap(m => m.members))], aliases = new Map();
  for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); for (const r of await s.all(`SELECT provider_id,canonical_id,verified,source_url FROM entity_aliases WHERE provider_id IN (${c.map(() => '?').join(',')})`, ...c)) aliases.set(r.provider_id, r); }
  for (const m of plan.merges) {
    const present = m.members.filter(id => aliases.has(id));
    if (present.length < 2) continue;
    // Anchor: an identity already verified by another source (e.g. Wikidata), else provider order.
    const external = present.filter(id => aliases.get(id).verified === 1 && aliases.get(id).source_url !== TEAM_EVIDENCE_URL);
    if (new Set(external.map(id => aliases.get(id).canonical_id)).size > 1) {
      await service.evidence.queue('team-match', present[0], TEAM_EVIDENCE_URL, {required: 'Linked fixtures pair teams that carry different verified identities', members: present, names: m.names});
      changed.protected++; changed.queued++; continue;
    }
    const anchor = external[0] ?? present[0], target = aliases.get(anchor).canonical_id, statements = [];
    for (const id of present) {
      const a = aliases.get(id);
      if (a.canonical_id === target && a.verified === 1) { changed.unchanged++; continue; }
      if (a.verified === 1 && a.source_url !== TEAM_EVIDENCE_URL && a.canonical_id !== target) { changed.protected++; continue; }
      statements.push(['UPDATE entity_aliases SET canonical_id=?,verified=1,source_url=? WHERE provider_id=?', target, a.source_url === TEAM_EVIDENCE_URL || a.verified !== 1 ? TEAM_EVIDENCE_URL : a.source_url, id]);
      // Reversible: the prior identity is kept for a year.
      statements.push(['INSERT INTO football_cache(id,payload,updated_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING', `team-identity:log:${id}`, JSON.stringify({from: a.canonical_id, fromVerified: a.verified, fromSource: a.source_url, to: target, anchor, members: present, at: s.now()}), s.now(), s.now() + 365 * 86400000]);
      changed.merged++;
    }
    if (statements.length) await s.batch(statements);
  }
  for (const c of plan.conflicts) { await service.evidence.queue('team-match', c.members[0], TEAM_EVIDENCE_URL, {required: c.reason, members: c.members, names: c.names}); changed.queued++; }
  return changed;
}

export async function syncTeamIdentities(service, {stopAt = Infinity} = {}) {
  const s = service.store, linking = await linkHistoricalFixtures(service, {stopAt});
  const rows = await s.all(`SELECT i.canonical_id,f.provider,f.home_team_id h,f.away_team_id a,ht.name hn,at.name an FROM fixture_identities i JOIN fixtures f ON f.id=i.fixture_id
    JOIN football_teams ht ON ht.id=f.home_team_id JOIN football_teams at ON at.id=f.away_team_id
    WHERE i.canonical_id IN (SELECT canonical_id FROM fixture_identities GROUP BY canonical_id HAVING COUNT(*)>1)`);
  const plan = planTeamIdentities(rows), changes = await applyTeamIdentities(service, plan);
  return {linking, pairs: plan.pairs, accepted: plan.accepted, rejected: plan.rejected.length, groups: plan.merges.length, conflicts: plan.conflicts.length, changes, stoppedEarly: s.now() >= stopAt};
}
