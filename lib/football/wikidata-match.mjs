// Wikidata identity matching for teams and competitions that have no permitted logo source (Wikidata is CC0).
// Evidence required for a match, all of it:
//   - the right type (P31): association football club, or a football league/competition;
//   - the right country (P17), checked against the competition's ISO code (P297) or its exact country name;
//   - an exact normalised name match with the item's label or an alias;
//   - no women's/youth/reserve mismatch between the provider name and the item;
//   - exactly one candidate passing all checks.
// Ambiguous or unsupported cases are recorded with the reason and never guessed. Once linked, the existing media
// pipeline fetches the Wikidata logo claim (P154) from Wikimedia Commons with its licence checks.
const API = 'https://www.wikidata.org/w/api.php';
const CLUB = new Set(['Q476028', 'Q103229495']), LEAGUE = new Set(['Q15991303', 'Q623109', 'Q13406554']);
const WOMEN = new Set(['Q51481377', 'Q103229495']), YOUTH = new Set(['Q20639856', 'Q3245375']);
const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'sd', 'ca', 'sfc', 'fcs', 'fk', 'sk', 'club', 'football', 'futbol', 'futebol', 'calcio', 'de', 'the', 'clube', 'club de', 'ud', 'us', 'as', 'ss', 'rc', 'rcd', 'cs', 'ks', 'nk', 'if', 'bk', 'ff']);
export const normName = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).join(' ');
const marker = s => { const n = String(s ?? '').toLowerCase(); return {women: /\b(women|womens|ladies|femenino|feminin|w)\b/.test(n), youth: /\b(u\d{2}|under|youth|juniors?|reserves?|ii|b team)\b/.test(n)}; };
const claimIds = (e, p) => (e?.claims?.[p] ?? []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const names = e => [...Object.values(e?.labels ?? {}).map(l => l.value), ...Object.values(e?.aliases ?? {}).flat().map(a => a.value)];

/** Pure decision over fetched candidate entities. Returns {qid} or {reason}. */
export function chooseCandidate(entity, kind, candidates, countries) {
  const want = normName(entity.name), m = marker(entity.name), passed = [];
  for (const c of candidates) {
    const types = claimIds(c, 'P31');
    if (!types.some(t => (kind === 'team' ? CLUB : LEAGUE).has(t))) continue;
    if (kind === 'team' && types.some(t => WOMEN.has(t)) !== m.women) continue;
    if (types.some(t => YOUTH.has(t)) && !m.youth) continue;
    if (names(c).some(n => marker(n).youth) && !m.youth && normName(c.labels?.en?.value ?? '') !== want) continue;
    if (!names(c).some(n => normName(n) === want)) continue;
    const country = claimIds(c, 'P17').map(id => countries.get(id)).filter(Boolean);
    const okCountry = country.some(k => (entity.countryCode && k.code && k.code.toUpperCase() === String(entity.countryCode).toUpperCase()) || (entity.country && k.labels.some(l => normName(l) === normName(entity.country))));
    if (!okCountry) continue;
    passed.push(c.id);
  }
  if (passed.length === 1) return {qid: passed[0]};
  return {reason: passed.length ? `ambiguous: ${passed.length} Wikidata items pass every check` : 'no Wikidata item passes type, country and exact-name checks'};
}

async function json(service, params) { return service.http.json('wikidata', API + '?' + new URLSearchParams({...params, format: 'json'})); }

/** Unresolved teams/competitions playing soon first, then the wider catalogue; bounded per run, resumable via cache. */
export async function wikidataMatch(service, {limit = 12} = {}) {
  const s = service.store, now = s.now(), out = {checked: 0, linked: 0, ambiguous: 0, noMatch: 0, skipped: 0, conflicts: 0, requests: 0, errors: []};
  const soon = new Set((await s.all('SELECT home_team_id h,away_team_id a,competition_id c FROM fixtures WHERE starts_at>? AND starts_at<?', now - 6 * 3600000, now + 2 * 864e5)).flatMap(r => [r.h, r.a, r.c]));
  const rows = await s.all("SELECT e.entity_id,e.entity_type FROM media_enrichment e JOIN entity_aliases a ON a.provider_id=e.entity_id AND a.verified=1 WHERE e.entity_type IN ('team','competition') AND e.state='skipped' AND json_extract(e.payload,'$.reason')='No verified media identity or permitted source' ORDER BY e.entity_id LIMIT 4000");
  const queue = [...rows.filter(r => soon.has(r.entity_id)), ...rows.filter(r => !soon.has(r.entity_id))];
  for (const row of queue) {
    if (out.checked >= limit) break;
    if (service.runDeadline && s.now() > service.runDeadline - 45000) break;
    const done = await s.cache(`wdmatch:${row.entity_id}`); if (done && !done.stale) continue;
    out.checked++;
    try {
      const kind = row.entity_type, rec = await s.one(`SELECT payload FROM ${kind === 'team' ? 'football_teams' : 'competitions'} WHERE id=?`, row.entity_id);
      const ent = rec ? JSON.parse(rec.payload) : null; if (!ent?.name) { out.skipped++; continue; }
      let comp = kind === 'competition' ? ent : null;
      if (!comp) { const f = await s.one('SELECT competition_id FROM fixtures WHERE home_team_id=? OR away_team_id=? ORDER BY starts_at DESC LIMIT 1', row.entity_id, row.entity_id); const c = f && await s.one('SELECT payload FROM competitions WHERE id=?', f.competition_id); comp = c ? JSON.parse(c.payload) : null; }
      const entity = {name: ent.name, country: comp?.country?.name ?? null, countryCode: comp?.country?.code?.length === 2 ? comp.country.code : null};
      if (!entity.country) { await s.putCache(`wdmatch:${row.entity_id}`, {state: 'skipped', reason: 'Country unknown (international competition only)'}, 30 * 864e5); out.skipped++; continue; }
      const search = await json(service, {action: 'wbsearchentities', search: ent.name, language: 'en', type: 'item', limit: '7'}); out.requests++;
      const ids = (search.search ?? []).map(x => x.id).filter(id => /^Q\d+$/.test(id));
      if (!ids.length) { await s.putCache(`wdmatch:${row.entity_id}`, {state: 'no-match', reason: 'No Wikidata search result'}, 30 * 864e5); out.noMatch++; continue; }
      const got = await json(service, {action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims'}); out.requests++;
      const cands = Object.values(got.entities ?? {});
      const cids = [...new Set(cands.flatMap(c => claimIds(c, 'P17')))].slice(0, 50), countries = new Map();
      if (cids.length) { const cs = await json(service, {action: 'wbgetentities', ids: cids.join('|'), props: 'labels|claims'}); out.requests++;
        for (const c of Object.values(cs.entities ?? {})) countries.set(c.id, {code: c.claims?.P297?.[0]?.mainsnak?.datavalue?.value ?? null, labels: Object.values(c.labels ?? {}).map(l => l.value)}); }
      const pick = chooseCandidate(entity, kind, cands, countries);
      if (!pick.qid) { await s.putCache(`wdmatch:${row.entity_id}`, {state: pick.reason.startsWith('ambiguous') ? 'ambiguous' : 'no-match', reason: pick.reason, candidates: ids}, 30 * 864e5); if (pick.reason.startsWith('ambiguous')) out.ambiguous++; else out.noMatch++; continue; }
      const linked = await linkWikidata(s, row.entity_id, kind, pick.qid, cands.find(c => c.id === pick.qid));
      if (linked.conflict) { out.conflicts++; await s.putCache(`wdmatch:${row.entity_id}`, {state: 'conflict', reason: linked.conflict, qid: pick.qid}, 30 * 864e5); continue; }
      out.linked++;
      await s.putCache(`wdmatch:${row.entity_id}`, {state: 'linked', qid: pick.qid, at: now}, 365 * 864e5);
      // Let the media stage retry this identity now that it has a Wikidata link.
      await s.run("UPDATE media_enrichment SET state='pending',next_attempt=0 WHERE entity_id=?", row.entity_id);
    } catch (e) { out.errors.push(`${row.entity_id}: ${String(e.message).slice(0, 120)}`); if (/quota|allocation|backoff|429/i.test(e.message)) break; }
  }
  return {...out, outcome: out.errors.length && !out.linked ? 'incomplete' : 'success'};
}

/** Add a verified Wikidata alias to the entity's canonical identity, never moving an identity already linked elsewhere. */
export async function linkWikidata(s, entityId, kind, qid, item) {
  const own = await s.one('SELECT canonical_id FROM entity_aliases WHERE provider_id=? AND verified=1', entityId); if (!own) return {conflict: 'Entity has no verified canonical identity'};
  const ce = await s.one('SELECT kind,wikidata_id FROM canonical_entities WHERE id=?', own.canonical_id);
  if (!ce || ce.kind !== kind) return {conflict: 'Canonical identity kind mismatch'};
  if (ce.wikidata_id && ce.wikidata_id !== qid) return {conflict: `Canonical identity already linked to ${ce.wikidata_id}`};
  const elsewhere = await s.one("SELECT canonical_id FROM entity_aliases WHERE provider='wikidata' AND provider_id=?", `wikidata:${qid}`);
  if (elsewhere && elsewhere.canonical_id !== own.canonical_id) return {conflict: `wikidata:${qid} already belongs to ${elsewhere.canonical_id}`};
  const taken = await s.one('SELECT id FROM canonical_entities WHERE wikidata_id=? AND id<>?', qid, own.canonical_id);
  if (taken) return {conflict: `wikidata:${qid} already set on ${taken.id}`};
  const label = item?.labels?.en?.value ?? Object.values(item?.labels ?? {})[0]?.value ?? qid;
  if (!ce.wikidata_id) await s.run('UPDATE canonical_entities SET wikidata_id=? WHERE id=?', qid, own.canonical_id);
  await s.run('INSERT INTO entity_aliases(id,canonical_id,provider,provider_id,alias,normalized_alias,verified,source_url) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(provider,provider_id) DO NOTHING',
    `wikidata:${qid}`, own.canonical_id, 'wikidata', `wikidata:${qid}`, label, normName(label), `https://www.wikidata.org/wiki/${qid}`);
  return {linked: true};
}
