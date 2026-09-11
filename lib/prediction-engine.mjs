const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));

export function formScore(form = []) {
  if (!form.length) return 0.5;
  const weights = form.map((_, index) => index + 1);
  const points = form.reduce((sum, result, index) => {
    const value = result === "W" ? 1 : result === "D" ? 0.5 : 0;
    return sum + value * weights[index];
  }, 0);
  return points / weights.reduce((sum, weight) => sum + weight, 0);
}

export function projectLineup(players = [], sport = "soccer") {
  const size = sport === "soccer" ? 11 : 5;
  const eligible = players
    .filter((player) => player.status === "available" || player.status === "doubtful")
    .map((player) => ({
      ...player,
      lineupScore: round(
        player.form * 0.45 + player.startRate * 0.4 + (player.status === "available" ? 10 : -8),
      ),
    }))
    .sort((a, b) => b.lineupScore - a.lineupScore);

  if (sport === "basketball") return eligible.slice(0, size);

  const quotas = { GK: 1, DEF: 4, MID: 3, FWD: 3 };
  const selected = [];
  for (const [position, count] of Object.entries(quotas)) {
    selected.push(...eligible.filter((p) => p.position === position).slice(0, count));
  }
  return [...new Map(selected.map((p) => [p.id, p])).values()].slice(0, size);
}

export function predictMatch(match) {
  const homeForm = formScore(match.home.form);
  const awayForm = formScore(match.away.form);
  const homeAvailability = availableStrength(match.home.players);
  const awayAvailability = availableStrength(match.away.players);
  const ratingEdge = (match.home.rating - match.away.rating) / 500;
  const formEdge = homeForm - awayForm;
  const availabilityEdge = homeAvailability - awayAvailability;
  const h2hEdge = match.h2h.homeWins / Math.max(match.h2h.games, 1) - match.h2h.awayWins / Math.max(match.h2h.games, 1);
  const edge = ratingEdge * 0.42 + formEdge * 0.28 + availabilityEdge * 0.18 + h2hEdge * 0.12;

  if (match.sport === "basketball") {
    const homeProbability = clamp(0.56 + edge * 0.48, 0.08, 0.92);
    const pace = (match.home.pace + match.away.pace) / 2;
    const projectedTotal = round(pace * ((match.home.attack + match.away.attack) / 200), 0);
    const margin = round((homeProbability - 0.5) * 28, 1);
    return {
      sport: match.sport,
      home: round(homeProbability * 100),
      away: round((1 - homeProbability) * 100),
      draw: 0,
      confidence: confidence(edge, match.home.players, match.away.players),
      projectedScore: `${Math.round(projectedTotal / 2 + margin / 2)}–${Math.round(projectedTotal / 2 - margin / 2)}`,
      total: projectedTotal,
      reasons: reasons(match, edge, homeForm, awayForm),
    };
  }

  const draw = clamp(0.25 - Math.abs(edge) * 0.12, 0.14, 0.29);
  const remaining = 1 - draw;
  const homeProbability = clamp(0.52 + edge * 0.5, 0.12, 0.88) * remaining;
  const awayProbability = remaining - homeProbability;
  const homeXg = clamp(1.42 + edge * 1.25 + (match.home.attack - 70) / 55, 0.35, 3.4);
  const awayXg = clamp(1.18 - edge * 1.1 + (match.away.attack - 70) / 60, 0.3, 3.1);
  return {
    sport: match.sport,
    home: round(homeProbability * 100),
    draw: round(draw * 100),
    away: round(awayProbability * 100),
    confidence: confidence(edge, match.home.players, match.away.players),
    projectedScore: `${Math.round(homeXg)}–${Math.round(awayXg)}`,
    expectedGoals: [round(homeXg, 2), round(awayXg, 2)],
    btts: round((1 - Math.exp(-homeXg)) * (1 - Math.exp(-awayXg)) * 100),
    over25: round(poissonOver25(homeXg + awayXg) * 100),
    reasons: reasons(match, edge, homeForm, awayForm),
  };
}

function availableStrength(players = []) {
  if (!players.length) return 0.5;
  const total = players.reduce((sum, p) => sum + p.form, 0);
  const available = players.reduce((sum, p) => {
    const availability = p.status === "available" ? 1 : p.status === "doubtful" ? 0.55 : 0;
    return sum + p.form * availability;
  }, 0);
  return available / total;
}

function confidence(edge, homePlayers, awayPlayers) {
  const unavailable = [...homePlayers, ...awayPlayers].filter((p) => p.status !== "available").length;
  return round(clamp(58 + Math.abs(edge) * 35 - unavailable * 1.7, 42, 88));
}

function reasons(match, edge, homeForm, awayForm) {
  const leader = edge >= 0 ? match.home.name : match.away.name;
  const formLeader = homeForm >= awayForm ? match.home.name : match.away.name;
  const h2hLeader = match.h2h.homeWins >= match.h2h.awayWins ? match.home.name : match.away.name;
  return [
    `${leader} has the stronger blended rating after venue adjustment.`,
    `${formLeader} carries the better recency-weighted form into this matchup.`,
    `${h2hLeader} has the head-to-head edge across the selected historical window.`,
  ];
}

function poissonOver25(lambda) {
  const p0 = Math.exp(-lambda);
  const p1 = p0 * lambda;
  const p2 = p1 * lambda / 2;
  return 1 - p0 - p1 - p2;
}

export function normalizeOpenFootballRound(payload, league = "OpenFootball") {
  const matches = payload?.matches || payload?.rounds?.flatMap((round) => round.matches || []) || [];
  return matches.map((match, index) => ({
    externalId: String(match.id || `${league}-${index}`),
    league,
    date: match.date || null,
    homeTeam: match.team1?.name || match.home?.name || match.home || "Unknown",
    awayTeam: match.team2?.name || match.away?.name || match.away || "Unknown",
    homeScore: match.score?.ft?.[0] ?? match.score1 ?? null,
    awayScore: match.score?.ft?.[1] ?? match.score2 ?? null,
  }));
}
