// Live Scores board: in-progress and recently finished matches, read from stored fixtures only.
// The live workers (5DollarFootballAPI batched live listing every 60 s; LiveScore one request per minute) are the only
// callers of the providers; this view never contacts a provider, so visitors never add provider requests.
import {privateCompetitions} from './identity-migration.mjs';
import {LIVE_STALE_MS} from './match-state.mjs';

export const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY', 'PAUSED', 'INT', 'SUSP', 'SUSPENDED', 'INTERRUPTED']);
export const FINAL = new Set(['FT', 'AET', 'PEN', 'FINISHED']);
export const RECENT_MS = 3 * 3600000, STALE_MS = 3 * 60000, OFFLINE_MS = 15 * 60000;

/** Human label for a stored status; minute only when the provider supplied one. Never a manufactured clock. */
export function liveLabel(f) {
  const s = String(f.status ?? '').toUpperCase(), minute = Number.isFinite(f.elapsed) ? `${f.elapsed}′` : null;
  const label = ({HT: 'Half-time', BT: 'Break before extra time', ET: 'Extra time', P: 'Penalty shoot-out', PAUSED: 'Paused', INT: 'Interrupted', INTERRUPTED: 'Interrupted',
    SUSP: 'Suspended', SUSPENDED: 'Suspended', FT: 'Full-time', FINISHED: 'Full-time', AET: 'After extra time', PEN: 'After penalties'})[s];
  if (label) return s === 'ET' && minute ? `${label} · ${minute}` : label;
  return minute ?? (LIVE.has(s) ? 'In progress' : s || 'Status unverified');
}

/** Latest successful provider observation, from the workers' own status records. */
export async function liveFreshness(store) {
  const fdfa = (await store.cache('live:fdfa:tick'))?.data ?? null, worker = (await store.cache('live:worker'))?.data ?? null;
  const times = [fdfa?.observedAt, worker?.state === 'success' ? worker.at : null].filter(Number.isFinite);
  return {lastUpdate: times.length ? Math.max(...times) : null, sources: {fivedollar: fdfa?.observedAt ?? null, livescore: worker?.state === 'success' ? worker.at : null}};
}

export function classifyBoard(fixtures, now, freshness) {
  const live = [], delayed = [], finished = [], unconfirmed = [];
  // Freshness is judged per source: a match whose feed has not updated recently is never presented as live.
  const sourceAt = f => !freshness.sources ? freshness.lastUpdate : f.provider === 'fivedollar' ? freshness.sources.fivedollar : freshness.sources.livescore;
  for (const f of fixtures) {
    const s = String(f.status ?? '').toUpperCase();
    if (LIVE.has(s)) {
      if (now - f.startsAt > LIVE_STALE_MS) unconfirmed.push(f);
      else { const at = sourceAt(f); (at != null && now - at <= STALE_MS ? live : delayed).push(f); }
    }
    else if (FINAL.has(s) && now - f.startsAt < RECENT_MS + 2 * 3600000) finished.push(f);
  }
  live.sort((a, b) => a.startsAt - b.startsAt); delayed.sort((a, b) => a.startsAt - b.startsAt); finished.sort((a, b) => b.startsAt - a.startsAt);
  const age = freshness.lastUpdate == null ? Infinity : now - freshness.lastUpdate;
  const state = age > OFFLINE_MS ? 'offline' : age > STALE_MS ? 'stale' : 'fresh';
  return {live, delayed, finished, unconfirmed: unconfirmed.length, state};
}

// One board per process for 5 s (single flight: concurrent requests share the pending build): every visitor in that window shares a single database read (the edge cache that
// public-cache.mjs uses is not available on Azure).
const memo = new WeakMap();
export async function liveBoard(service) {
  if (!service.store.readOnly) return buildBoard(service);   // writers and tests always read fresh
  const key = service.store.db ?? service.store, hit = memo.get(key), at = Date.now();
  if (hit && at - hit.at < 5000 && hit.value) return hit.value;
  const value = hit?.pending ?? buildBoard(service);
  memo.set(key, {at: hit?.at ?? 0, value: hit?.value, pending: value});
  try { const board = await value; memo.set(key, {at, value: board}); return board; } catch (e) { memo.delete(key); throw e; }
}

async function buildBoard(service) {
  const s = service.store, now = s.now();
  // Kickoffs in the last 4 h cover every match still in play; finished matches stay for about three hours after the end.
  const raw = (await s.all('SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<=?', now - 5 * 3600000, now + 15 * 60000)).map(r => JSON.parse(r.payload));
  const hidden = await privateCompetitions(s, raw.map(f => f.competition?.id));
  const fixtures = await service.deduplicateFixtures(raw.filter(f => !hidden.has(f.competition?.id)));
  const ids = [...new Set(fixtures.map(f => f.competition?.id).filter(Boolean))], canon = new Map(), names = new Map();
  for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); for (const r of await s.all(`SELECT provider_id,canonical_id FROM entity_aliases WHERE verified=1 AND canonical_id LIKE 'competition:%' AND provider_id IN (${c.map(() => '?').join(',')})`, ...c)) canon.set(r.provider_id, r.canonical_id); }
  const cids = [...new Set(canon.values())];
  for (let i = 0; i < cids.length; i += 400) { const c = cids.slice(i, i + 400); for (const r of await s.all(`SELECT id,name FROM canonical_entities WHERE id IN (${c.map(() => '?').join(',')})`, ...c)) names.set(r.id, r.name); }
  for (const f of fixtures) { const c = canon.get(f.competition?.id); if (c) { f.competitionCanonical = c; f.competitionName = names.get(c) ?? f.competition.name; } f.liveLabel = liveLabel(f); }
  const freshness = await liveFreshness(s), board = classifyBoard(fixtures, now, freshness);
  return {generatedAt: now, ...freshness, ...board, refreshSeconds: 10,
    note: 'Scores come from the live provider feeds stored by Mnemba; minutes are shown only when the provider supplies them.'};
}
