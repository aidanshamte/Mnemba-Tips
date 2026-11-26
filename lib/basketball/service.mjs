// Basketball stage and views: sync (BALLDONTLIE), daily chronological evaluation, immutable pre-game predictions
// (created before tip-off) and grading after finals. Nothing here uses demonstration data.
import {syncBasketball, bdlState} from './balldontlie.mjs';
import {replay, features, fitCalibration, predict, evaluate, MODEL} from './model.mjs';
import {digest} from '../football/digest.mjs';

export async function loadGames(s, where = '1=1', ...args) {
  return (await s.all(`SELECT payload FROM basketball_games WHERE ${where} ORDER BY starts_at,id`, ...args)).map(r => JSON.parse(r.payload));
}

/** Calibration for published predictions: fitted on all completed seasons before the current one; refreshed daily. */
async function calibration(s, games, now) {
  const c = (await s.cache('bball:calibration'))?.data; if (c && now - c.at < 864e5) return c.cal;
  const current = Math.max(...games.map(g => g.season)), rows = [];
  replay(games.filter(g => g.season < current), (st, g) => { if (g.status === 'FT' && Number.isInteger(g.homeScore)) rows.push({f: features(st, g), game: g}); });
  const cal = fitCalibration(rows); await s.putCache('bball:calibration', {at: now, cal}, 7 * 864e5); return cal;
}

export async function basketballStage(service) {
  const s = service.store, now = s.now(), out = {sync: null, predictions: 0, graded: 0};
  out.sync = await syncBasketball(service, {historyPages: Number(service.env?.BALLDONTLIE_HISTORY_PAGES) || 2});
  const games = await loadGames(s);
  if (!games.length) return {outcome: 'success', ...out, state: out.sync.state ?? 'empty'};
  const ev = (await s.cache('bball:evaluation'))?.data;
  if (!ev || now - ev.at > 864e5) await s.putCache('bball:evaluation', {at: now, result: evaluate(games.filter(g => g.status === 'FT'))}, 7 * 864e5);
  const cal = await calibration(s, games, now);
  const state = replay(games.filter(g => g.status === 'FT' && g.startsAt < now));
  for (const g of games.filter(x => x.status === 'NS' && x.startsAt > now && x.startsAt < now + 2 * 864e5)) {
    if (await s.one('SELECT id FROM basketball_predictions WHERE game_id=? AND model_version=?', g.id, MODEL)) continue;
    const p = predict(features(state, g), cal); if (p.state !== 'ok') continue;
    await s.run('INSERT OR IGNORE INTO basketball_predictions(id,game_id,model_version,created_at,starts_at,payload) VALUES(?,?,?,?,?,?)', await digest([g.id, MODEL, now]), g.id, MODEL, now, g.startsAt, JSON.stringify(p)); out.predictions++;
  }
  for (const r of await s.all("SELECT p.id,p.game_id,p.payload,g.payload game FROM basketball_predictions p JOIN basketball_games g ON g.id=p.game_id LEFT JOIN basketball_grades x ON x.prediction_id=p.id WHERE x.prediction_id IS NULL AND g.status='FT'")) {
    const p = JSON.parse(r.payload), g = JSON.parse(r.game); if (!Number.isInteger(g.homeScore)) continue;
    const y = g.homeScore > g.awayScore ? 1 : 0, ph = p.winner.home;
    const h1 = g.quarters?.home?.[1] != null && g.quarters?.away?.[1] != null ? g.quarters.home[0] + g.quarters.home[1] + g.quarters.away[0] + g.quarters.away[1] : null;
    const grade = {final: {home: g.homeScore, away: g.awayScore}, winnerCorrect: (ph >= 0.5) === (y === 1), brier: (ph - y) ** 2, logLoss: -Math.log(Math.max(1e-12, y ? ph : 1 - ph)),
      marginError: g.homeScore - g.awayScore - p.margin.expected, totalError: g.homeScore + g.awayScore - p.total.expected, firstHalfTotalError: h1 != null && p.firstHalf ? h1 - p.firstHalf.total.expected : null, source: 'BALLDONTLIE final'};
    await s.run('INSERT OR IGNORE INTO basketball_grades(prediction_id,game_id,settled_at,payload) VALUES(?,?,?,?)', r.id, r.game_id, now, JSON.stringify(grade)); out.graded++;
  }
  return {outcome: 'success', ...out};
}

/** Public view: live, next 48 h (with predictions), recent results, standings from results, evaluation, freshness. */
export async function basketballView(service) {
  const s = service.store, now = s.now(), st = bdlState(service.env);
  const games = await loadGames(s, 'starts_at>? AND starts_at<?', now - 2 * 864e5, now + 2 * 864e5);
  const preds = new Map((await s.all('SELECT game_id,created_at,payload FROM basketball_predictions WHERE starts_at>?', now - 2 * 864e5)).map(r => [r.game_id, {...JSON.parse(r.payload), createdAt: Number(r.created_at)}]));
  const withPred = g => ({...g, prediction: preds.get(g.id) ?? null});
  const season = (await s.one("SELECT MAX(season) n FROM basketball_games WHERE status='FT' AND postseason=0"))?.n;
  const table = new Map();
  for (const r of season != null ? await s.all("SELECT home_team_id h,away_team_id a,home_score hs,away_score aws FROM basketball_games WHERE season=? AND status='FT' AND postseason=0", season) : []) {
    for (const [id, win] of [[r.h, r.hs > r.aws], [r.a, r.aws > r.hs]]) { const t = table.get(id) ?? {w: 0, l: 0}; if (win) t.w++; else t.l++; table.set(id, t); }
  }
  const teams = new Map((await s.all('SELECT id,name,abbreviation,conference FROM basketball_teams')).map(t => [t.id, t]));
  const standings = ['East', 'West'].map(conf => ({conference: conf, rows: [...table.entries()].filter(([id]) => teams.get(id)?.conference === conf).map(([id, t]) => ({id, name: teams.get(id)?.name, abbreviation: teams.get(id)?.abbreviation, ...t, pct: t.w / Math.max(1, t.w + t.l)})).sort((a, b) => b.pct - a.pct || b.w - a.w)}));
  const evaluation = (await s.cache('bball:evaluation'))?.data ?? null, sync = (await s.cache('bball:last-sync'))?.data ?? null, live = (await s.cache('bball:live-status'))?.data ?? null;
  return {league: 'NBA', source: 'BALLDONTLIE', configured: st.enabled, reason: st.reason ?? null, season: season ?? null, lastSync: sync?.at ?? null, liveCheckedAt: live?.at ?? null,
    live: games.filter(g => ['LIVE', 'HT'].includes(g.status)).map(withPred), upcoming: games.filter(g => g.status === 'NS' && g.startsAt > now).map(withPred),
    recent: games.filter(g => g.status === 'FT').sort((a, b) => b.startsAt - a.startsAt).slice(0, 20).map(withPred), standings: season != null ? standings : [],
    evaluation: evaluation?.result ?? null, historicalGames: Number((await s.one("SELECT COUNT(*) n FROM basketball_games WHERE status='FT'")).n),
    note: 'NBA data from BALLDONTLIE (not official league data). Standings are computed from recorded results.'};
}

export async function basketballGame(service, id) {
  const s = service.store, row = await s.one('SELECT payload FROM basketball_games WHERE id=?', id); if (!row) return {unavailable: true};
  const g = JSON.parse(row.payload);
  const form = async teamId => (await loadGames(s, "status='FT' AND starts_at<? AND (home_team_id=? OR away_team_id=?)", g.startsAt, teamId, teamId)).slice(-5).reverse().map(x => ({id: x.id, startsAt: x.startsAt, opponent: x.home.id === teamId ? x.away.name : x.home.name, home: x.home.id === teamId, for: x.home.id === teamId ? x.homeScore : x.awayScore, against: x.home.id === teamId ? x.awayScore : x.homeScore}));
  const h2h = (await loadGames(s, "status='FT' AND starts_at<? AND ((home_team_id=? AND away_team_id=?) OR (home_team_id=? AND away_team_id=?))", g.startsAt, g.home.id, g.away.id, g.away.id, g.home.id)).slice(-5).reverse();
  const venue = async (teamId, home) => { const r = await s.one(`SELECT SUM(CASE WHEN ${home ? 'home_score>away_score' : 'away_score>home_score'} THEN 1 ELSE 0 END) w, COUNT(*) n FROM basketball_games WHERE status='FT' AND season=? AND postseason=0 AND ${home ? 'home_team_id' : 'away_team_id'}=? AND starts_at<?`, g.season, teamId, g.startsAt); return {w: Number(r?.w ?? 0), l: Number(r?.n ?? 0) - Number(r?.w ?? 0)}; };
  const pred = await s.one('SELECT created_at,payload FROM basketball_predictions WHERE game_id=? ORDER BY created_at LIMIT 1', id), grade = pred ? await s.one('SELECT payload FROM basketball_grades WHERE game_id=?', id) : null;
  return {game: g, prediction: pred ? {...JSON.parse(pred.payload), createdAt: Number(pred.created_at)} : null, grade: grade ? JSON.parse(grade.payload) : null,
    form: {home: await form(g.home.id), away: await form(g.away.id)}, headToHead: h2h, homeRecord: await venue(g.home.id, true), awayRecord: await venue(g.away.id, false), at: s.now()};
}
