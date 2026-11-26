// BALLDONTLIE (NBA) adapter: free plan = teams, players, games (quarter scores from 2023, realtime in-progress games).
// Terms (2026-10-20): data may be cached, stored, displayed and used commercially and for model training; no attribution
// required; not to be stated as official league data; the API must not be resold as a substitute feed; live data is
// best effort. Free rate limit 5 requests/minute: the source registry spaces requests 12.5 s apart.
const API = 'https://api.balldontlie.io/v1';
export const BDL = 'balldontlie';

export function bdlState(env = {}) {
  if (!env.BALLDONTLIE_API_KEY) return {enabled: false, reason: 'BALLDONTLIE_API_KEY is not configured'};
  return {enabled: true};
}

const int = v => Number.isInteger(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null;
export const teamId = id => `${BDL}:nba:${id}`;

export function normalizeTeam(t) {
  return {id: teamId(t.id), provider: BDL, external_id: String(t.id), league: 'NBA', name: t.full_name ?? t.name, abbreviation: t.abbreviation ?? null, city: t.city ?? null, conference: t.conference ?? null, division: t.division ?? null,
    payload: JSON.stringify({id: teamId(t.id), name: t.full_name ?? t.name, abbreviation: t.abbreviation, city: t.city, conference: t.conference, division: t.division})};
}

/** Status from the provider's fields: Final → FT; a period > 0 that is not final → LIVE (half-time kept); else NS. */
export function gameStatus(g) {
  const s = String(g.status ?? '').trim();
  if (/^final/i.test(s)) return {status: 'FT', label: s};
  if (/postponed/i.test(s)) return {status: 'PST', label: s};
  if (/cancel/i.test(s)) return {status: 'CANC', label: s};
  if (/half/i.test(s)) return {status: 'HT', label: 'Half-time'};
  if ((int(g.period) ?? 0) > 0) return {status: 'LIVE', label: `${s}${g.time ? ' ' + g.time : ''}`.trim()};
  return {status: 'NS', label: s};
}

export function normalizeGame(g, now = Date.now()) {
  const start = Date.parse(g.datetime ?? '') || Date.parse(g.status ?? '') || Date.parse(`${g.date}T00:00:00Z`);
  if (!Number.isFinite(start) || !g.home_team?.id || !g.visitor_team?.id) throw Error('Incomplete BALLDONTLIE game');
  const st = gameStatus(g), q = side => ['q1', 'q2', 'q3', 'q4'].map(k => int(g[`${side}_${k}`])), ot = side => ['ot1', 'ot2', 'ot3'].map(k => int(g[`${side}_${k}`])).filter(v => v != null);
  const scored = st.status !== 'NS' && int(g.home_team_score) != null && int(g.visitor_team_score) != null;
  const payload = {id: `${BDL}:${g.id}`, league: 'NBA', season: int(g.season), startsAt: start, timeKnown: Boolean(g.datetime), status: st.status, label: st.label, period: int(g.period), clock: g.time ?? null, postseason: Boolean(g.postseason),
    home: {id: teamId(g.home_team.id), name: g.home_team.full_name, abbreviation: g.home_team.abbreviation}, away: {id: teamId(g.visitor_team.id), name: g.visitor_team.full_name, abbreviation: g.visitor_team.abbreviation},
    homeScore: scored ? int(g.home_team_score) : null, awayScore: scored ? int(g.visitor_team_score) : null,
    quarters: {home: q('home'), away: q('visitor')}, overtime: {home: ot('home'), away: ot('visitor')}, source: 'BALLDONTLIE', observedAt: now};
  return {id: payload.id, provider: BDL, external_id: String(g.id), league: 'NBA', season: payload.season ?? 0, starts_at: start, status: st.status, period: payload.period, home_team_id: payload.home.id, away_team_id: payload.away.id,
    home_score: payload.homeScore, away_score: payload.awayScore, postseason: g.postseason ? 1 : 0, payload: JSON.stringify(payload)};
}

/** Shared, atomic per-minute limiter (database row per clock minute): at most 5 BALLDONTLIE requests per minute
 * across the web live worker and every job. Returns false when the current minute is full. */
export const PER_MINUTE = 5;
export async function reserveMinute(s) {
  const m = Math.floor(s.now() / 60000);
  const row = await s.one('INSERT INTO source_request_usage(source_id,day,used) VALUES(?,?,1) ON CONFLICT(source_id,day) DO UPDATE SET used=source_request_usage.used+1 WHERE source_request_usage.used<? RETURNING used', BDL, `m:${m}`, PER_MINUTE);
  return Boolean(row);
}
export class RateWindowFull extends Error { constructor() { super('BALLDONTLIE per-minute window full'); this.name = 'RateWindowFull'; } }

async function get(service, path, params, {fresh = false, wait = true} = {}) {
  // Wait for the next minute at most once (sync); the live tick does not wait.
  if (!await reserveMinute(service.store)) {
    if (!wait) throw new RateWindowFull();
    const ms = 60000 - (service.store.now() % 60000) + 500;
    if (service.runDeadline && service.store.now() + ms > service.runDeadline - 60000) throw new RateWindowFull();
    await service.http.sleep(ms);
    if (!await reserveMinute(service.store)) throw new RateWindowFull();
  }
  const url = new URL(API + path); for (const [k, v] of Object.entries(params ?? {})) for (const x of [].concat(v)) url.searchParams.append(k, String(x));
  const res = await service.http.request(BDL, url.href, {headers: {Authorization: service.env.BALLDONTLIE_API_KEY, Accept: 'application/json'}, fresh});
  if (!res.ok) throw Error(`BALLDONTLIE HTTP ${res.status}`);
  return res.json();
}

/** A finished game's stored result is never replaced by a non-final observation. */
export async function saveGames(s, rows) {
  let saved = 0;
  for (const r of rows) {
    const old = await s.one('SELECT status,payload FROM basketball_games WHERE id=?', r.id);
    if (old?.status === 'FT' && r.status !== 'FT') continue;
    if (old?.payload === r.payload) continue;
    await s.upsert('basketball_games', {...r, updated_at: s.now()}); saved++;
  }
  return saved;
}

/** Teams (daily), the current window (yesterday..+2 days) and a bounded slice of history per run. */
export async function syncBasketball(service, opts = {}) {
  try { return await syncInner(service, opts); } catch (e) { if (e.name === 'RateWindowFull') return {outcome: 'incomplete', state: 'rate-window-full'}; throw e; }
}
async function syncInner(service, {historyPages = 2, seasons = [2023, 2024, 2025]} = {}) {
  const st = bdlState(service.env), s = service.store, now = s.now();
  if (!st.enabled) return {outcome: 'success', state: 'disabled', reason: st.reason};
  const out = {requests: 0, teams: 0, games: 0, history: 0};
  const deadline = (service.runDeadline ?? Infinity) - 60000;
  if (!(await s.cache('bball:teams'))?.data) {
    const t = await get(service, '/teams', {per_page: 100}); out.requests++;
    for (const team of (t.data ?? []).filter(x => x.conference && x.division)) { await s.upsert('basketball_teams', {...normalizeTeam(team), updated_at: now}); out.teams++; }
    await s.putCache('bball:teams', {at: now, count: out.teams}, 7 * 864e5);
  }
  const day = d => new Date(now + d * 864e5).toISOString().slice(0, 10);
  let cursor = null;
  do {
    if (s.now() > deadline) break;
    const r = await get(service, '/games', {start_date: day(-1), end_date: day(2), per_page: 100, ...(cursor ? {cursor} : {})}, {fresh: true}); out.requests++;
    out.games += await saveGames(s, (r.data ?? []).map(g => normalizeGame(g, s.now())));
    cursor = r.meta?.next_cursor ?? null;
  } while (cursor);
  // History: resumable per season through the provider cursor.
  for (const season of seasons) {
    let state = (await s.cache(`bball:history:${season}`))?.data ?? {cursor: null, done: false, pages: 0};
    while (!state.done && historyPages > 0 && s.now() < deadline) {
      const r = await get(service, '/games', {'seasons[]': season, per_page: 100, ...(state.cursor ? {cursor: state.cursor} : {})}); out.requests++; historyPages--;
      out.history += await saveGames(s, (r.data ?? []).map(g => normalizeGame(g, s.now())));
      state = {cursor: r.meta?.next_cursor ?? null, done: !r.meta?.next_cursor, pages: state.pages + 1};
      await s.putCache(`bball:history:${season}`, state, 365 * 864e5);
    }
  }
  await s.putCache('bball:last-sync', {...out, at: s.now()}, 30 * 864e5);
  return {outcome: 'success', ...out};
}

/** Live worker: today's games every 60 s while any is in progress or within 15 minutes of tip-off. */
export async function basketballLiveTick(service) {
  const st = bdlState(service.env), s = service.store, now = s.now(); if (!st.enabled) return {state: 'disabled'};
  const due = await s.one("SELECT COUNT(*) n FROM basketball_games WHERE (status IN ('LIVE','HT')) OR (status='NS' AND starts_at BETWEEN ? AND ?)", now - 4 * 3600000, now + 15 * 60000);
  if (!Number(due?.n)) return {state: 'idle'};
  const last = (await s.cache('bball:live-tick'))?.data; if (last && now - last.at < 58000) return {state: 'not-due'};
  await s.putCache('bball:live-tick', {at: now}, 864e5);
  const today = new Date(now).toISOString().slice(0, 10), yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
  let r; try { r = await get(service, '/games', {'dates[]': [yesterday, today], per_page: 100}, {fresh: true, wait: false}); } catch (e) { if (e.name === 'RateWindowFull') return {state: 'rate-window-full'}; throw e; }
  const changed = await saveGames(s, (r.data ?? []).map(g => normalizeGame(g, s.now())));
  await s.putCache('bball:live-status', {at: s.now(), games: (r.data ?? []).length, changed}, 864e5);
  return {state: 'success', changed};
}
