// 5DollarFootballAPI (Pro plan) adapter: fixtures, live status, results, events, statistics, corners, cards,
// odds and provider standings. Server-side only.
//
// Secret handling: the key is read from process.env.FIVE_DOLLAR_FOOTBALL_API_KEY (Azure secretRef) and sent only
// in the Authorization header. It never appears in URLs, cache keys, cached bodies, errors, logs or results.
//
// Request discipline (Pro: 10 requests per 60 s per account, no daily cap; verified via /status 2026-11-20):
// - At most PER_MINUTE requests in any clock minute, recorded in the database (source_request_usage) so every
//   process sharing the account shares the cap. SourceHttp adds a 6.5 s minimum gap, Retry-After handling and
//   exponential backoff, the response cache and the administrator disable flag.
// - A per-run request budget and a stage time box (75 s core, 60 s details, never within 45 s of the run deadline).
//   Work resumes from saved cursors on the next run. Provider stages run last so they cannot starve existing stages.
// - Ingestion uses the cheap path (no per-batch grading or prediction recomputation); the hourly models stage grades
//   and captures forecasts.
// - A circuit breaker opens after repeated failures (longer after authentication or plan errors).
// - Emergency disable: MNEMBA_FDFA_DISABLED=1, or source_registry.user_enabled=0.
// - Settlement: only status "finished" with no status_reason is a final result. Cup-style competitions are not
//   graded from this provider alone, because its final score may include extra time.
import {ingestFixtureBatch, recordIngestionHealth} from './fixture-ingestion.mjs';
import {labelFor} from './providers.mjs';
import {norm, normTeam, teamsMatch, genderOf, ageOf, resolveCompetition} from './competition-identity.mjs';
import {EVIDENCE_URL} from './identity-migration.mjs';

export const FDFA_SOURCE = 'fivedollar';
export const FDFA_BASE = 'https://api.5dollarfootballapi.com/v1';
export const FDFA_KEY_ENV = 'FIVE_DOLLAR_FOOTBALL_API_KEY';
export const FDFA_DISABLE_ENV = 'MNEMBA_FDFA_DISABLED';
export const FDFA_ATTRIBUTION = 'Data from 5DollarFootballAPI';
export const PER_MINUTE = 9; // one below the account limit, leaving headroom for manual checks
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const CUP = /\b(cup|copa|coupe|coppa|pokal|taca|beker|trophy|shield|super ?cup|supercopa|play ?offs?|knockout|qualif\w*|friendl\w*)\b/;

export function fdfaState(env = {}) {
  if (env[FDFA_DISABLE_ENV] === '1') return {enabled: false, reason: 'Disabled by emergency switch'};
  if (!env[FDFA_KEY_ENV]) return {enabled: false, reason: 'Provider key not configured'};
  return {enabled: true, reason: null};
}

const ids = {
  fixture: id => `${FDFA_SOURCE}:${id}`,
  team: id => `${FDFA_SOURCE}:t${id}`,
  league: id => `${FDFA_SOURCE}:l${id}`,
};
const int = v => Number.isInteger(v) ? v : null;
const required = (v, name) => { if (v === null || v === undefined || v === '') throw Error(`5DollarFootballAPI missing ${name}`); return v; };

export class FdfaStop extends Error { constructor(message) { super(message); this.name = 'FdfaStop'; } }

/** Season label/year for a league; the catalog's current season, else the kickoff calendar year. */
function seasonFor(league, startsAt) {
  const current = (league?.seasons ?? []).find(s => s?.current) ?? null;
  const label = current?.season ? String(current.season) : String(new Date(startsAt).getUTCFullYear());
  const year = Number(label.slice(0, 4));
  return {label, year: Number.isFinite(year) ? year : new Date(startsAt).getUTCFullYear(), resolution: current ? 'provider-current-season' : 'kickoff-calendar-year'};
}

export function fdfaCompetition(league, startsAt) {
  const id = ids.league(required(league?.id, 'league id')), season = seasonFor(league, startsAt);
  const code = league.country?.code ? String(league.country.code) : null;
  return {
    id, provider: FDFA_SOURCE, externalId: String(league.id), name: required(league.name, 'league name'), type: null,
    country: league.country?.name ? {id: `${FDFA_SOURCE}:c${code ?? norm(league.country.name)}`, provider: FDFA_SOURCE, externalId: code ?? league.country.name, name: league.country.name, code: code && code.length === 2 ? code : null, continent: null} : null,
    seasons: [{id: `${id}:${season.label}`, competitionId: id, year: season.year, label: season.label, current: season.resolution === 'provider-current-season', seasonResolution: season.resolution,
      coverage: {fixtures: true, live: true, events: true, statistics: true, odds: true, standings: league.has_standings === true}}],
  };
}

/** Map provider status to the shared vocabulary. Only an unqualified "finished" settles. */
export function fdfaStatus(raw, cupLike) {
  const code = raw.status_code == null ? null : String(raw.status_code), minute = /^\d+$/.test(code ?? '') ? Number(code) : null;
  if (raw.status === 'scheduled') return {status: 'NS', elapsed: null};
  if (raw.status === 'in_play') {
    if (code === 'half') return {status: 'HT', elapsed: 45};
    if (minute != null) return {status: minute <= 45 ? '1H' : minute <= 105 ? '2H' : 'ET', elapsed: minute};
    return {status: 'LIVE', elapsed: null}; // "full": awaiting confirmation
  }
  if (raw.status === 'finished' && raw.status_reason == null) return cupLike ? {status: 'UNKNOWN', elapsed: null, note: 'Final score may include extra time; regulation result needs another provider'} : {status: 'FT', elapsed: null};
  return {status: 'UNKNOWN', elapsed: null, note: raw.status_reason ? `Provider reports ${raw.status_reason}` : 'Provider status unknown'};
}

export function normalizeFdfaFixture(raw, catalog = new Map()) {
  const fid = required(int(raw?.id), 'fixture id'), ts = required(int(raw?.kickoff_ts), 'kickoff');
  const startsAt = ts * 1000;
  if (!Number.isFinite(startsAt)) throw Error('5DollarFootballAPI invalid kickoff');
  const league = {...(catalog.get(raw.league?.id) ?? {}), id: raw.league?.id, name: catalog.get(raw.league?.id)?.name ?? raw.league?.name};
  const competition = fdfaCompetition(league, startsAt), cupLike = CUP.test(norm(competition.name));
  const team = t => ({id: ids.team(required(int(t?.id), 'team id')), provider: FDFA_SOURCE, externalId: String(t.id), name: required(t.name, 'team name')});
  const {status, elapsed, note} = fdfaStatus(raw, cupLike);
  const goals = raw.goals ?? {}, scored = status !== 'NS' && int(goals.home) != null && int(goals.away) != null;
  return {
    id: ids.fixture(fid), provider: FDFA_SOURCE, externalId: String(fid), competition, seasonId: competition.seasons[0].id,
    home: team(raw.teams?.home), away: team(raw.teams?.away), startsAt, kickoffPrecision: 'instant', timeZone: 'UTC',
    status, label: labelFor(status), elapsed, venue: null,
    homeScore: scored ? goals.home : null, awayScore: scored ? goals.away : null,
    ...(status === 'FT' ? {regulationScore: {home: goals.home, away: goals.away}} : {}),
    halfTimeScore: int(goals.half_home) != null && int(goals.half_away) != null ? {home: goals.half_home, away: goals.half_away} : null,
    corners: raw.corners ? {home: int(raw.corners.home), away: int(raw.corners.away), halfHome: int(raw.corners.half_home), halfAway: int(raw.corners.half_away)} : null,
    cards: raw.cards ? {home: {yellow: int(raw.cards.home?.yellow), red: int(raw.cards.home?.red)}, away: {yellow: int(raw.cards.away?.yellow), red: int(raw.cards.away?.red)}} : null,
    providerStatus: {status: raw.status, reason: raw.status_reason ?? null, code: raw.status_code ?? null, ...(note ? {note} : {})},
    sourceUrl: `${FDFA_BASE}/fixtures/${fid}`, sourceAttribution: FDFA_ATTRIBUTION,
    coverageNote: 'Licensed provider feed (Pro plan). Settled only on an unqualified finished status.',
  };
}

const STAT_LABELS = {attacks: 'Attacks', dangerous_attacks: 'Dangerous Attacks', shots_on_target: 'Shots on Goal', shots_off_target: 'Shots off Goal', possession: 'Ball Possession'};
/** Events, statistics (including corners and cards) and odds from an include=events,stats,odds listing row. */
export function fdfaDetails(raw, fixture) {
  const side = s => s === 'home' ? fixture.home : s === 'away' ? fixture.away : null;
  const events = Array.isArray(raw.events) ? raw.events.map((e, i) => ({
    id: `${fixture.id}:e${i}:${e.type}:${e.minute ?? ''}:${e.team ?? ''}`, minute: int(e.minute), team: side(e.team) && {id: side(e.team).id, name: side(e.team).name},
    // Substitutions carry player_in/player_out name strings; period_score rows carry the period and score.
    player: typeof e.player_in === 'string' ? e.player_in : null, playerOut: typeof e.player_out === 'string' ? e.player_out : null,
    type: String(e.type ?? 'event').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), detail: e.period ?? null, providerType: e.type ?? null, count: int(e.count),
    score: e.score && typeof e.score === 'object' ? {home: int(e.score.home), away: int(e.score.away)} : null,
  })) : null;
  let statistics = null;
  if (raw.statistics || fixture.corners || fixture.cards) {
    const st = raw.statistics ?? {};
    statistics = ['home', 'away'].map(s => ({team: {id: side(s).id, name: side(s).name}, statistics: [
      ...Object.entries(STAT_LABELS).filter(([k]) => st[k]).map(([k, type]) => ({type, value: k === 'possession' && st[k][s] != null ? `${st[k][s]}%` : st[k][s] ?? null})),
      ...(fixture.corners ? [{type: 'Corner Kicks', value: fixture.corners[s]}] : []),
      ...(fixture.cards ? [{type: 'Yellow Cards', value: fixture.cards[s].yellow}, {type: 'Red Cards', value: fixture.cards[s].red}] : []),
    ], firstHalf: st.first_half ? Object.fromEntries(Object.entries(STAT_LABELS).filter(([k]) => st.first_half[k]).map(([k, type]) => [type, st.first_half[k][s] ?? null])) : null}));
  }
  return {events, statistics, odds: raw.odds && typeof raw.odds === 'object' ? raw.odds : null};
}

export function normalizeFdfaStandings(data) {
  if (!data || !Array.isArray(data.table)) throw Error('5DollarFootballAPI standings envelope');
  return {season: String(required(data.season, 'season')), type: data.type ?? 'total', round: int(data.round), source: data.source ?? null,
    rows: data.table.map(r => ({position: int(r.position), team: {id: ids.team(required(int(r.team?.id), 'team id')), name: required(r.team?.name, 'team name')},
      played: int(r.played), won: int(r.win), drawn: int(r.draw), lost: int(r.lose), goalsFor: int(r.goals_for ?? r.total_for), goalsAgainst: int(r.goals_against ?? r.total_against),
      // The live API returns goals_*; the documentation shows total_* and average_*. Accept either, never guess.
      goalDifference: int(r.goal_difference) ?? (int(r.goals_for ?? r.total_for) != null && int(r.goals_against ?? r.total_against) != null ? int(r.goals_for ?? r.total_for) - int(r.goals_against ?? r.total_against) : null), points: int(r.points)}))};
}

/** Same club: matching names and identical gender, age and reserve markers ("Arsenal" is not "Arsenal Women"). */
const reserve = n => (norm(n).match(/\b(ii|iii|b|reserves?|academy)\b/g) ?? []).sort().join(',');
export function sameTeam(a, b) {
  return genderOf(a) === genderOf(b) && ageOf(a) === ageOf(b) && reserve(a) === reserve(b) && teamsMatch(normTeam(a), normTeam(b));
}

/** Rate-limited, circuit-protected client. All requests go through SourceHttp. */
export class FiveDollarClient {
  constructor(service, {budget = 6, stopAt = Infinity} = {}) { this.service = service; this.store = service.store; this.budget = budget; this.stopAt = stopAt; this.requests = 0; }
  /** Stage time box: stop before the next request or page once reached; cursors resume next run. */
  checkTime() { if (this.store.now() >= this.stopAt) throw new FdfaStop('Stage time limit reached; remaining work resumes next run'); }
  get key() { return this.service.env?.[FDFA_KEY_ENV]; }
  async circuit() { return (await this.store.cache('fdfa:circuit'))?.data ?? {failures: 0, openUntil: 0}; }
  async trip(reason, ms) {
    const c = await this.circuit(), failures = c.failures + 1, open = ms ?? (failures >= 3 ? Math.min(2 * HOUR, 15 * MINUTE * 2 ** (failures - 3)) : 0);
    await this.store.putCache('fdfa:circuit', {failures, openUntil: open ? this.store.now() + open : 0, reason}, 7 * DAY);
  }
  async reserve() {
    const s = this.store;
    for (let attempt = 0; attempt < 2; attempt++) {
      const m = Math.floor(s.now() / MINUTE);
      const row = await s.one('INSERT INTO source_request_usage(source_id,day,used) VALUES(?,?,1) ON CONFLICT(source_id,day) DO UPDATE SET used=source_request_usage.used+1 WHERE source_request_usage.used<? RETURNING used', FDFA_SOURCE, `m:${String(m).padStart(10, '0')}`, PER_MINUTE);
      if (row) return;
      await this.service.http.sleep((m + 1) * MINUTE - s.now() + 250);
    }
    throw new FdfaStop('Per-minute request window full');
  }
  async get(path, params = {}) {
    const state = fdfaState(this.service.env);
    if (!state.enabled) throw new FdfaStop(state.reason);
    const c = await this.circuit();
    if (c.openUntil > this.store.now()) throw new FdfaStop(`Circuit open after repeated failures (${c.reason ?? 'provider errors'})`);
    if (this.requests >= this.budget) throw new FdfaStop('Run request budget used; remaining work resumes next run');
    // Include the spacing wait SourceHttp will apply: a request that would start after the box closes is not attempted.
    const next = Number((await this.store.one('SELECT next_allowed_at FROM source_registry WHERE id=?', FDFA_SOURCE))?.next_allowed_at ?? 0);
    if (Math.max(this.store.now(), next) >= this.stopAt) throw new FdfaStop('Stage time limit reached; remaining work resumes next run');
    const url = new URL(FDFA_BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    await this.reserve();
    this.requests++;
    let response;
    try {
      response = await this.service.http.request(FDFA_SOURCE, url.href, {headers: {Authorization: `Bearer ${this.key}`, Accept: 'application/json'}});
    } catch (error) {
      // SourceHttp messages carry only the source name and HTTP status.
      if (/backoff active|deadline|deferred beyond/i.test(error.message)) throw new FdfaStop(error.message);
      await this.trip(error.message.replace(/[^\w :;,.()-]/g, '').slice(0, 120));
      throw new FdfaStop(error.message);
    }
    const remaining = response.headers.get('x-ratelimit-remaining'), reset = Number(response.headers.get('x-ratelimit-reset'));
    if (remaining === '0' && reset > 0) await this.store.run('UPDATE source_registry SET next_allowed_at=? WHERE id=?', Math.max(this.store.now(), reset * 1000), FDFA_SOURCE);
    let body = null; try { body = await response.json(); } catch {}
    if (response.status === 301 && body?.error?.canonical_id) return {moved: body.error.canonical_id};
    if (response.status === 404) return {notFound: body?.error?.code ?? 'not_found'};
    if (response.status === 401 || response.status === 403) { await this.trip(`HTTP ${response.status} ${body?.error?.code ?? ''}`.trim(), 6 * HOUR); throw new FdfaStop(`5DollarFootballAPI: HTTP ${response.status} ${body?.error?.code ?? ''}`.trim()); }
    if (!response.ok || body?.success !== 1) { await this.trip(`HTTP ${response.status}`); throw new FdfaStop(`5DollarFootballAPI: HTTP ${response.status} ${body?.error?.code ?? ''}`.trim()); }
    if (c.failures) await this.store.putCache('fdfa:circuit', {failures: 0, openUntil: 0, reason: null}, 7 * DAY);
    return body;
  }
  /** League catalog with seasons, cached for 24 h. */
  async leagues() {
    const cached = await this.store.cache('fdfa:leagues');
    if (cached && !cached.stale) return new Map(cached.data.map(l => [l.id, l]));
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const body = await this.get('/leagues', {per_page: 100, page, include: 'seasons'});
      all.push(...(body.data ?? []));
      if (!body.pagination?.has_more) break;
    }
    await this.store.putCache('fdfa:leagues', all, DAY);
    return new Map(all.map(l => [l.id, l]));
  }
}

/**
 * Mapping of the provider's live league catalog (the authenticated /leagues response is the source of truth; counts are
 * never hard-coded) to canonical competitions. Stored in football_cache "fdfa:catalog-map" with a summary.
 */
export async function fdfaCatalogMap(store, catalog) {
  const now = store.now();
  const aliases = new Map((await store.all("SELECT provider_id,canonical_id,verified,source_url FROM entity_aliases WHERE provider=? AND canonical_id LIKE 'competition:%'", FDFA_SOURCE)).map(r => [r.provider_id, r]));
  const reviews = new Map((await store.all("SELECT entity_id,kind FROM verification_queue WHERE id LIKE 'identity:%' AND status='pending' AND entity_id LIKE ?", `${FDFA_SOURCE}:%`)).map(r => [r.entity_id, r.kind]));
  const observed = new Set((await store.all('SELECT id FROM competitions WHERE provider=?', FDFA_SOURCE)).map(r => r.id));
  const providersOf = new Map();
  for (const r of await store.all("SELECT canonical_id,provider FROM entity_aliases WHERE verified=1 AND canonical_id LIKE 'competition:%'")) { if (!providersOf.has(r.canonical_id)) providersOf.set(r.canonical_id, new Set()); providersOf.get(r.canonical_id).add(r.provider); }
  const moved = (await store.cache('fdfa:moved'))?.data ?? {};
  const rows = [...catalog.values()].map(l => {
    const providerId = ids.league(l.id), alias = aliases.get(providerId), review = reviews.get(providerId);
    const identity = resolveCompetition({id: providerId, provider: FDFA_SOURCE, externalId: String(l.id), name: l.name, type: null, country: l.country?.name ? {name: l.country.name} : null, gender: null});
    const lastFixtureAt = Number.isFinite(l.last_fixture_ts) ? l.last_fixture_ts * 1000 : null;
    const status = moved[l.id] ? 'moved'
      : lastFixtureAt != null && now - lastFixtureAt > 365 * DAY ? 'retired'
      : review ? 'ambiguous'
      : alias?.verified === 1 ? (alias.source_url === EVIDENCE_URL ? 'mapped-auto' : 'mapped-manual')
      : identity.scopeKind === 'unscoped' ? 'unsupported'
      : observed.has(providerId) ? 'awaiting-identity-run' : 'awaiting-fixtures';
    return {providerLeagueId: l.id, providerId, canonicalId: alias?.verified === 1 ? alias.canonical_id : null, providerName: l.name, country: l.country?.name ?? null, countryCode: l.country?.code ?? null,
      available: lastFixtureAt != null && now - lastFixtureAt < 60 * DAY, popular: l.is_popular === true, hasStandings: l.has_standings === true, lastFixtureAt, lastObservedAt: now, status,
      ...(review ? {reviewKind: review} : {}), ...(moved[l.id] ? {movedTo: moved[l.id]} : {}),
      sharedWithOtherProviders: alias?.verified === 1 ? [...(providersOf.get(alias.canonical_id) ?? [])].some(p => p !== FDFA_SOURCE) : false, resolvedAs: identity.canonicalId, structural: !!(identity.stage || identity.group)};
  });
  // Two provider leagues resolving to one competition (outside stage/group structure) may be duplicates.
  const byResolved = new Map(); for (const r of rows) if (!r.structural) byResolved.set(r.resolvedAs, [...(byResolved.get(r.resolvedAs) ?? []), r.providerLeagueId]);
  const potentialDuplicates = [...byResolved].filter(([, v]) => v.length > 1).map(([resolvedAs, providerLeagueIds]) => ({resolvedAs, providerLeagueIds}));
  const count = status => rows.filter(r => r.status === status).length;
  const summary = {at: now, total: rows.length, mappedAuto: count('mapped-auto'), mappedManual: count('mapped-manual'), mappedSharedWithOtherProviders: rows.filter(r => r.sharedWithOtherProviders).length,
    ambiguous: count('ambiguous'), unsupported: count('unsupported'), retiredOrMoved: count('retired') + count('moved'), awaitingIdentityRun: count('awaiting-identity-run'), awaitingFixtures: count('awaiting-fixtures'),
    available: rows.filter(r => r.available).length, potentialDuplicates: potentialDuplicates.length};
  await store.putCache('fdfa:catalog-map', {summary, potentialDuplicates, rows}, 30 * DAY);
  return summary;
}

/** Link provider fixtures to other providers' records for the same match: kickoff within 15 minutes and both teams match. */
export async function linkFdfaFixtures(service, fixtures) {
  const s = service.store, out = {linked: 0, alreadyLinked: 0, ambiguous: 0, unmatched: 0};
  for (const f of fixtures) {
    const own = await s.one('SELECT canonical_id FROM fixture_identities WHERE fixture_id=?', f.id);
    if (!own) continue;
    const candidates = await s.all("SELECT f.id,f.payload,i.canonical_id FROM fixtures f JOIN fixture_identities i ON i.fixture_id=f.id WHERE f.provider<>? AND f.starts_at>=? AND f.starts_at<=?", FDFA_SOURCE, f.startsAt - 15 * MINUTE, f.startsAt + 15 * MINUTE);
    const targets = [...new Set(candidates.filter(c => { const p = JSON.parse(c.payload); return sameTeam(p.home.name, f.home.name) && sameTeam(p.away.name, f.away.name); }).map(c => c.canonical_id))];
    if (!targets.length) { out.unmatched++; continue; }
    if (targets.length > 1) { out.ambiguous++; await service.evidence.queue('fixture-match', f.id, f.sourceUrl, {required: 'Several canonical fixtures match kickoff and teams; verify before linking', candidates: targets}); continue; }
    if (own.canonical_id === targets[0]) { out.alreadyLinked++; continue; }
    await s.run("UPDATE fixture_identities SET canonical_id=?,verification='provider-match' WHERE fixture_id=?", targets[0], f.id);
    await service.evidence.conflicts(targets[0]);
    out.linked++;
  }
  return out;
}

async function saveDetails(service, rows) {
  const s = service.store, out = {events: 0, statistics: 0, odds: 0};
  for (const {fixture, details} of rows) {
    for (const [table, data, key] of [['fixture_events', details.events, 'events'], ['fixture_statistics', details.statistics, 'statistics']]) {
      if (!data) continue;
      const prior = await s.one(`SELECT payload FROM ${table} WHERE fixture_id=?`, fixture.id);
      if (prior?.payload === JSON.stringify(data)) continue;
      await service.detailRecord(table, fixture, data); out[key]++;
    }
    // Odds are stored as provider evidence; they are not shown as betting advice.
    if (details.odds) { await s.putCache(`odds:${fixture.id}`, {provider: FDFA_SOURCE, retrievedAt: s.now(), markets: details.odds, attribution: FDFA_ATTRIBUTION}, 14 * DAY); out.odds++; }
  }
  return out;
}

/** One listing window (max 24 h), resumable across runs through a page cursor. */
async function windowTask(service, client, catalog, task, summary, providers) {
  const s = service.store, cursorKey = `fdfa:cursor:${task.key}`, done = task.ttl ? await s.cache(`fdfa:done:${task.key}`) : null;
  if (done && !done.stale) { providers.push({provider: FDFA_SOURCE, request: {window: task.key}, attempted: false, state: 'cached', confirmed: done.data.count}); return; }
  let page = (await s.cache(cursorKey))?.data?.page ?? 1, count = (await s.cache(cursorKey))?.data?.count ?? 0;
  for (;;) {
    const body = await client.get('/fixtures', {start_time: task.start, end_time: task.end, status: task.status, include: task.include, per_page: task.include ? 50 : task.status === 'live' ? 500 : 100, page});
    const rows = body.data ?? [], details = [];
    const report = await ingestFixtureBatch(service, FDFA_SOURCE, {window: task.key, page}, counts => {
      counts.raw = rows.length; const out = [];
      for (const raw of rows) {
        try { const f = normalizeFdfaFixture(raw, catalog); out.push(f); if (task.include) details.push({fixture: f, details: fdfaDetails(raw, f)}); }
        catch (error) { counts.rejected++; (counts.errors ??= []).push(`${raw?.id ?? 'unknown'}: ${error.message}`); }
      }
      return out;
    }, {liveOnly: true});
    providers.push(report);
    const saved = rows.length ? (await s.all(`SELECT payload FROM fixtures WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map(r => ids.fixture(r.id)))).map(r => JSON.parse(r.payload)) : [];
    const link = await linkFdfaFixtures(service, saved);
    for (const k of Object.keys(link)) summary.links[k] += link[k];
    if (details.length) { const d = await saveDetails(service, details); for (const k of Object.keys(d)) summary.details[k] += d[k]; }
    summary.fixtures += report.normalized; summary.inserted += report.inserted; summary.updated += report.updated; summary.rejected += report.rejected;
    count += rows.length;
    if (!body.pagination?.has_more) { if (task.ttl) await s.putCache(`fdfa:done:${task.key}`, {count, at: s.now()}, task.ttl); await s.putCache(cursorKey, {page: 1, count: 0}, DAY); return; }
    page++; await s.putCache(cursorKey, {page, count}, DAY);
    client.checkTime();
  }
}

async function standingsTask(service, client, catalog, summary, limit = 2) {
  const s = service.store;
  const present = new Set((await s.all("SELECT DISTINCT competition_id FROM fixtures WHERE provider=?", FDFA_SOURCE)).map(r => r.competition_id));
  let done = 0;
  for (const league of catalog.values()) {
    if (done >= limit) break;
    if (!league.has_standings || !present.has(ids.league(league.id))) continue;
    const fresh = await s.cache(`fdfa:standings:${league.id}`);
    if (fresh && !fresh.stale) continue;
    done++;
    const body = await client.get('/standings', {league: league.id, type: 'total'});
    if (body.notFound || body.moved) { await s.putCache(`fdfa:standings:${league.id}`, {state: body.notFound ?? 'moved'}, DAY); continue; }
    const table = normalizeFdfaStandings(body.data), seasonId = `${ids.league(league.id)}:${table.season}`;
    if (!await s.one('SELECT id FROM seasons WHERE id=?', seasonId)) { await s.putCache(`fdfa:standings:${league.id}`, {state: 'season-not-recorded'}, DAY); summary.standingsSkipped++; continue; }
    await s.upsert('standings', {id: `${FDFA_SOURCE}:standings:${league.id}:${table.season}:total`, season_id: seasonId, label: 'Provider standings', payload: JSON.stringify({...table, attribution: FDFA_ATTRIBUTION, retrievedAt: s.now()}), updated_at: s.now()});
    await s.putCache(`fdfa:standings:${league.id}`, {state: 'stored', rows: table.rows.length}, DAY);
    summary.standings++;
  }
}

/**
 * History backfill (Pro: 12 months, /leagues/{id}/fixtures has no 24 h cap). Forecasts need three recorded results
 * per team, so leagues are served by their soonest upcoming provider fixture. Uses only budget and time left after the
 * stage's own windows; at most 6 pages (600 matches) per league, then not repeated for 7 days.
 */
async function historyTask(service, client, catalog, summary) {
  const s = service.store, now = s.now(), prefix = `${FDFA_SOURCE}:l`;
  const leagues = await s.all("SELECT competition_id,MIN(starts_at) next FROM fixtures WHERE provider=? AND starts_at>? AND starts_at<? AND status IN ('NS','TBD') GROUP BY competition_id ORDER BY MIN(starts_at)", FDFA_SOURCE, now, now + 8 * DAY);
  for (const {competition_id: competitionId} of leagues) {
    if (!competitionId?.startsWith(prefix)) continue;
    const leagueId = Number(competitionId.slice(prefix.length)), key = `fdfa:history:${leagueId}`, state = await s.cache(key);
    if (state?.data?.done && !state.stale) continue;
    let page = state?.data?.page ?? 1;
    for (;;) {
      const body = await client.get(`/leagues/${leagueId}/fixtures`, {status: 'finished', start_time: Math.floor((now - 365 * DAY) / 1000), end_time: Math.floor(now / 1000), order: 'desc', per_page: 100, page});
      if (body.notFound || body.moved) { await s.putCache(key, {done: true, state: body.notFound ?? 'moved'}, 7 * DAY); break; }
      const rows = body.data ?? [];
      const report = await ingestFixtureBatch(service, FDFA_SOURCE, {history: leagueId, page}, counts => {
        counts.raw = rows.length; const out = [];
        for (const raw of rows) { try { out.push(normalizeFdfaFixture(raw, catalog)); } catch (error) { counts.rejected++; (counts.errors ??= []).push(`${raw?.id ?? 'unknown'}: ${error.message}`); } }
        return out;
      }, {liveOnly: true});
      summary.history.fixtures += report.normalized; summary.history.inserted += report.inserted; summary.history.rejected += report.rejected;
      if (!body.pagination?.has_more || page >= 6) { await s.putCache(key, {done: true, pages: page, at: now}, 7 * DAY); summary.history.leagues++; break; }
      page++; await s.putCache(key, {page}, 7 * DAY);
      client.checkTime();
    }
  }
}

/**
 * mode "core" (hourly): live, today's and yesterday's results, the next 24 h, then later days in rotation.
 * mode "details" (three-hourly): events, statistics and odds for recent results and upcoming fixtures, then standings.
 */
export async function syncFiveDollar(service, {mode = 'core', budget, timeLimitMs} = {}) {
  const s = service.store, state = fdfaState(service.env);
  if (!state.enabled) return {state: 'disabled', reason: state.reason, providers: [{provider: FDFA_SOURCE, attempted: false, state: 'disabled', reason: state.reason}]};
  // Time box: the stage's own limit, and never closer than 45 s to the scheduled run's deadline.
  const limit = timeLimitMs ?? (mode === 'core' ? 75000 : 60000), stopAt = Math.min(s.now() + limit, (service.runDeadline ?? Infinity) - 45000);
  const client = new FiveDollarClient(service, {budget: budget ?? (mode === 'core' ? 8 : 12), stopAt});
  const summary = {mode, requests: 0, fixtures: 0, inserted: 0, updated: 0, rejected: 0, links: {linked: 0, alreadyLinked: 0, ambiguous: 0, unmatched: 0}, details: {events: 0, statistics: 0, odds: 0}, standings: 0, standingsSkipped: 0, history: {leagues: 0, fixtures: 0, inserted: 0, rejected: 0}, deferred: null};
  const providers = [], errors = [], now = Math.floor(s.now() / 1000), day = now - (now % 86400);
  const tasks = mode === 'core' ? [
    {key: 'live', status: 'live', ttl: 0},
    {key: `finished:${day}`, start: day, end: now, status: 'finished', ttl: 50 * MINUTE},
    {key: `finished:${day - 86400}`, start: day - 86400, end: day - 1, status: 'finished', ttl: 3 * HOUR},
    {key: `scheduled:next24`, start: now, end: now + 86399, status: 'scheduled', ttl: 3 * HOUR},
    ...[1, 2, 3, 4, 5, 6].map(d => ({key: `scheduled:${day + d * 86400}`, start: day + d * 86400, end: day + d * 86400 + 86399, status: 'scheduled', ttl: 12 * HOUR})),
  ] : [
    {key: `details:${day - 86400}`, start: day - 86400, end: day - 1, status: 'finished', include: 'events,stats,odds', ttl: 12 * HOUR},
    {key: `details:${day}`, start: day, end: now, status: 'finished', include: 'events,stats,odds', ttl: 3 * HOUR},
    {key: `odds:next24`, start: now, end: now + 86399, status: 'scheduled', include: 'odds', ttl: 6 * HOUR},
  ];
  let catalog = null;
  try {
    await s.run("DELETE FROM source_request_usage WHERE source_id=? AND day LIKE 'm:%' AND day<?", FDFA_SOURCE, `m:${String(Math.floor(s.now() / MINUTE) - 1440).padStart(10, '0')}`);
    catalog = await client.leagues();
    summary.leagues = catalog.size;
    for (const task of tasks) await windowTask(service, client, catalog, task, summary, providers);
    if (mode === 'details') await standingsTask(service, client, catalog, summary);
    // Leftover budget and time go to history, so forecasts become possible for provider-only leagues.
    await historyTask(service, client, catalog, summary);
  } catch (error) {
    if (error instanceof FdfaStop) summary.deferred = error.message; else errors.push(`fivedollar: ${error.message}`);
  }
  summary.requests = client.requests;
  // Mapping report reflects this run's imports, including when the budget deferred the rest.
  if (catalog) try { summary.catalog = await fdfaCatalogMap(s, catalog); } catch (error) { errors.push(`fivedollar catalog map: ${error.message}`); }
  for (const p of providers) for (const e of p.errors ?? []) errors.push(e);
  const health = await recordIngestionHealth(s, `fivedollar-${mode}`, providers);
  console.log('mnemba_fivedollar', JSON.stringify({mode, requests: summary.requests, fixtures: summary.fixtures, inserted: summary.inserted, updated: summary.updated, linked: summary.links.linked, standings: summary.standings, deferred: summary.deferred}));
  return {...summary, errors, ingestion: {state: health.state, reasons: health.reasons}, providers: providers.map(p => ({provider: p.provider, request: p.request, state: p.state, raw: p.raw, normalized: p.normalized, inserted: p.inserted, updated: p.updated, unchanged: p.unchanged, rejected: p.rejected}))};
}
