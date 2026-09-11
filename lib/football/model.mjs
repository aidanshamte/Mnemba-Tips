import { FINAL } from './providers.mjs';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function historyFor(fixtures, teamId, before = Infinity, venue = null) {
  return fixtures.filter(f => FINAL.has(f.status) && f.startsAt < before && f.homeScore !== null && f.awayScore !== null && (venue === 'home' ? f.home.id === teamId : venue === 'away' ? f.away.id === teamId : f.home.id === teamId || f.away.id === teamId)).sort((a,b) => a.startsAt-b.startsAt);
}
export function form(fixtures, teamId, before = Infinity, venue = null) {
  const games = historyFor(fixtures, teamId, before, venue).slice(-10);
  const results = games.map(f => { const difference = (f.homeScore-f.awayScore)*(f.home.id === teamId ? 1 : -1); return difference > 0 ? 'W' : difference < 0 ? 'L' : 'D'; });
  const weights = results.reduce((n,_,i) => n+i+1,0);
  return { label: games.length ? 'Historical' : 'Unavailable', games: games.length, results, score: weights ? results.reduce((n,r,i) => n + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0)*(i+1),0)/weights : null };
}
export function headToHead(fixtures, home, away, before = Infinity) {
  const games = historyFor(fixtures,home,before).filter(f => f.home.id === away || f.away.id === away).slice(-10);
  return { label: games.length ? 'Historical' : 'Unavailable', games: games.length, homeWins: games.filter(f => (f.homeScore-f.awayScore)*(f.home.id === home ? 1 : -1)>0).length, awayWins: games.filter(f => (f.homeScore-f.awayScore)*(f.home.id === home ? 1 : -1)<0).length, draws: games.filter(f => f.homeScore === f.awayScore).length, fixtures: games };
}
export function elo(fixtures, before) {
  const ratings = new Map();
  for (const f of fixtures.filter(f => FINAL.has(f.status) && f.startsAt < before && f.homeScore != null && f.awayScore != null).sort((a,b) => a.startsAt-b.startsAt)) {
    const home = ratings.get(f.home.id) ?? 1500, away = ratings.get(f.away.id) ?? 1500;
    const result = f.homeScore > f.awayScore ? 1 : f.homeScore === f.awayScore ? 0.5 : 0;
    const delta = 24*(result-1/(1+10**((away-home-55)/400)));
    ratings.set(f.home.id,home+delta); ratings.set(f.away.id,away-delta);
  }
  return ratings;
}
export function predictedLineup(players) {
  const eligible = players.filter(p => !['injured','suspended','out'].includes(p.availability) && Number.isFinite(p.minutes) && Number.isFinite(p.rating));
  const lineup = [];
  for (const [position,count] of Object.entries({ GK:1, DEF:4, MID:3, FWD:3 })) lineup.push(...eligible.filter(p => p.position === position).sort((a,b) => (b.minutes*0.01+b.rating-(b.availability === 'doubtful' ? 2:0))-(a.minutes*0.01+a.rating-(a.availability === 'doubtful' ? 2:0))).slice(0,count));
  return { label: lineup.length === 11 ? 'PitchPredict model projection' : 'Unavailable', formation: '4-3-3', players: lineup.length === 11 ? lineup : [], reason: lineup.length === 11 ? 'Ranked from recorded minutes, performance and availability' : 'Insufficient position, minutes or performance coverage for a full XI' };
}
export function project(fixture, history, context = {}) {
  const cutoff = fixture.startsAt;
  const home = form(history,fixture.home.id,cutoff), away = form(history,fixture.away.id,cutoff);
  if (home.games < 3 || away.games < 3) return { label: 'Unavailable', reason: 'At least three completed historical matches per team are required', missing: ['Historical team form'] };
  const ratings = elo(history,cutoff), h2h = headToHead(history,fixture.home.id,fixture.away.id,cutoff);
  const homeVenue = form(history,fixture.home.id,cutoff,'home'), awayVenue = form(history,fixture.away.id,cutoff,'away');
  const homeGames = historyFor(history,fixture.home.id,cutoff), awayGames = historyFor(history,fixture.away.id,cutoff);
  const rest = clamp((awayGames.at(-1).startsAt-homeGames.at(-1).startsAt)/86400000,-7,7);
  const factors = { elo: ((ratings.get(fixture.home.id)??1500)-(ratings.get(fixture.away.id)??1500))/400, form: home.score-away.score, venueForm: homeVenue.score !== null && awayVenue.score !== null ? homeVenue.score-awayVenue.score : null, headToHead: h2h.games ? (h2h.homeWins-h2h.awayWins)/h2h.games : null, restDays: rest, venueAdvantage: fixture.venue ? 0.13 : null,
    expectedGoals: context.expectedGoals ?? null, availability: context.availability ?? null, lineupStrength: context.lineupStrength ?? null, playerPerformance: context.playerPerformance ?? null, competitionStrength: context.competitionStrength ?? null };
  const edge = factors.elo*0.5 + factors.form*0.35 + (factors.venueForm??0)*0.15 + (factors.headToHead??0)*0.08 + rest*0.012 + (factors.venueAdvantage??0) + (factors.availability??0)*0.1 + (factors.lineupStrength??0)*0.1 + (factors.playerPerformance??0)*0.05;
  const scoring = (games, team) => games.slice(-10).reduce((n,g) => n+(g.home.id === team ? g.homeScore : g.awayScore),0)/Math.min(games.length,10);
  const pace = clamp(context.competitionStrength ?? 1,0.7,1.3);
  const hx = clamp((context.expectedGoals?.[0] ?? scoring(homeGames,fixture.home.id))*pace + edge*0.5,0.15,4.5);
  const ax = clamp((context.expectedGoals?.[1] ?? scoring(awayGames,fixture.away.id))*pace - edge*0.5,0.15,4.5);
  const poisson = (k, lambda) => { let p = Math.exp(-lambda); for(let i=1;i<=k;i++) p*=lambda/i; return p; };
  const probabilities = [0,0,0];
  for(let h=0;h<=20;h++) for(let a=0;a<=20;a++) probabilities[h>a?0:h===a?1:2]+=poisson(h,hx)*poisson(a,ax);
  const total=probabilities.reduce((a,b)=>a+b,0);
  return { label: 'PitchPredict model projection', modelVersion: 'football-elo-poisson-1', probabilities: probabilities.map(p=>p/total), expectedGoals: [hx,ax], factors, missing: Object.entries(factors).filter(([,v])=>v===null).map(([k])=>k), evidence: { home,away,h2h }, note: 'Uncalibrated baseline; missing factors are omitted. Provider predictions are separate.' };
}
export function evaluate(prediction, fixture) {
  if (!FINAL.has(fixture.status) || fixture.homeScore === null || fixture.awayScore === null) return null;
  const outcome = fixture.homeScore>fixture.awayScore?0:fixture.homeScore===fixture.awayScore?1:2;
  return { outcome, brier: prediction.probabilities.reduce((n,p,i)=>n+(p-(i===outcome?1:0))**2,0), correct: prediction.probabilities.indexOf(Math.max(...prediction.probabilities))===outcome };
}
