// Match event timeline from stored provider rows. Only documented event types are shown; nothing is inferred from a
// score change, and minutes are exactly what the provider supplied (no running clock).
// Formats handled: 5DollarFootballAPI (providerType goal|yellow_card|red_card|substitution|missed_penalty|period_score),
// LiveScore incidents (goal rows carry a score array; other numeric codes are undocumented and left out),
// API-Football (type Goal|Card|subst|Var with documented detail strings and time.elapsed/time.extra).

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const PERIODS = {first_half: 'Half-time', second_half: 'Full-time', extra_time: 'After extra time', overtime: 'After extra time', penalties: 'Penalty shoot-out'};

function sideOf(team, fixture) {
  if (!team || !fixture) return null;
  const id = typeof team === 'object' ? team.id : null, name = norm(typeof team === 'object' ? team.name : team);
  for (const side of ['home', 'away']) {
    const t = fixture[side]; if (!t) continue;
    if (id && id === t.id) return side;
    if (name && name === norm(t.name)) return side;
  }
  return null;
}

/** One provider row to zero or one timeline entry (without id). Returns null for rows that are not match events. */
function classify(r, fixture) {
  const pt = String(r.providerType ?? '').toLowerCase(), type = String(r.type ?? ''), detail = String(r.detail ?? '');
  const team = r.team ?? null, teamName = typeof team === 'object' ? team?.name ?? null : team;
  const base = {minute: num(r.minute ?? r.time?.elapsed), added: num(r.time?.extra), side: sideOf(team, fixture), teamName,
    player: typeof r.player === 'string' ? r.player : r.player?.name ?? null, related: null, shootout: false};
  // API-Football (documented detail strings).
  if (r.time && typeof r.time === 'object') {
    const shootout = /shootout/i.test(String(r.comments ?? ''));
    const assist = r.assist?.name ?? null;
    if (type === 'Goal') {
      if (detail === 'Missed Penalty') return {...base, kind: 'missed-penalty', label: 'Penalty missed', shootout};
      if (detail === 'Own Goal') return {...base, kind: 'own-goal', label: 'Own goal'};
      if (detail === 'Penalty') return {...base, kind: shootout ? 'shootout-scored' : 'penalty-goal', label: shootout ? 'Shoot-out penalty scored' : 'Penalty goal', shootout};
      return {...base, kind: 'goal', label: 'Goal', related: assist ? `Assist: ${assist}` : null};
    }
    if (type === 'Card') return detail === 'Yellow Card' ? {...base, kind: 'yellow', label: 'Yellow card'} : detail === 'Second Yellow card' ? {...base, kind: 'second-yellow', label: 'Second yellow card'} : detail === 'Red Card' ? {...base, kind: 'red', label: 'Red card'} : null;
    if (type === 'subst') return {...base, kind: 'substitution', label: 'Substitution', player: assist, related: base.player ? `Off: ${base.player}` : null};
    if (type === 'Var') return {...base, kind: /cancel|disallow/i.test(detail) ? 'disallowed' : 'var', label: /cancel|disallow/i.test(detail) ? 'Goal disallowed (VAR)' : `VAR: ${detail}`};
    return null;
  }
  // 5DollarFootballAPI.
  if (pt === 'goal') return {...base, kind: 'goal', label: 'Goal'};
  if (pt === 'yellow_card') return {...base, kind: 'yellow', label: 'Yellow card'};
  if (pt === 'red_card') return {...base, kind: 'red', label: 'Red card'};
  if (pt === 'missed_penalty') return {...base, kind: 'missed-penalty', label: 'Penalty missed'};
  if (pt === 'substitution') return {...base, kind: 'substitution', label: 'Substitution', related: r.playerOut ? `Off: ${r.playerOut}` : null};
  if (pt === 'period_score') {
    const label = PERIODS[detail] ?? null, s = r.score;
    if (!label || s?.home == null || s?.away == null) return null;
    return {...base, minute: null, side: null, kind: detail === 'penalties' ? 'shootout-result' : 'period', label: `${label} ${s.home}–${s.away}`, period: detail, shootout: detail === 'penalties'};
  }
  if (pt === 'corner') return null;   // a statistic, shown in match statistics
  // LiveScore: a row carrying a score array is a goal; other numeric codes are undocumented.
  if (Array.isArray(r.score) && r.score.length === 2) return {...base, kind: 'goal', label: 'Goal', score: {home: num(r.score[0]), away: num(r.score[1])}};
  if (type === 'Goal') return {...base, kind: 'goal', label: 'Goal'};
  if (/^(Yellow card|Red card|Substitution)$/i.test(type)) return {...base, kind: type.toLowerCase().startsWith('yellow') ? 'yellow' : type.toLowerCase().startsWith('red') ? 'red' : 'substitution', label: type};
  return undefined;   // undocumented
}

const PERIOD_ORDER = {first_half: 45.99, second_half: 90.99, extra_time: 120.99, overtime: 120.99, penalties: 999};

/**
 * @returns {{events: object[], shootout: object[], omitted: number, available: boolean}}
 * Events are chronological with stable ids (kind, minute, added, side, player and an ordinal for genuine repeats), so a
 * repeated delivery never duplicates and a provider correction (a removed or changed row) is reflected as delivered.
 */
export function matchTimeline(rows, fixture) {
  const list = (Array.isArray(rows) ? rows.flat() : []).filter(r => r && typeof r === 'object');
  let omitted = 0; const out = [], seen = new Map(), raw = new Set();
  list.forEach((r, i) => {
    const key = JSON.stringify(r); if (raw.has(key)) return; raw.add(key);   // exact duplicate deliveries
    const e = classify(r, fixture);
    if (e === undefined) { omitted++; return; }
    if (!e) return;
    const sig = [e.kind, e.minute ?? '', e.added ?? '', e.side ?? norm(e.teamName), norm(e.player), e.period ?? ''].join('|');
    const n = (seen.get(sig) ?? 0) + 1; seen.set(sig, n);
    out.push({...e, id: `${fixture?.id ?? 'match'}:${sig}:${n}`, order: i});
  });
  // A VAR disallowal cancels the closest earlier goal of the same team.
  for (const d of out.filter(e => e.kind === 'disallowed')) {
    const g = out.filter(e => ['goal', 'penalty-goal', 'own-goal'].includes(e.kind) && e.side === d.side && !e.disallowed && (e.minute ?? 0) <= (d.minute ?? 0) + 1).sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0))[0];
    if (g) { g.disallowed = true; g.label = `${g.label} (disallowed)`; }
  }
  const at = e => e.kind === 'period' || e.kind === 'shootout-result' ? PERIOD_ORDER[e.period] ?? 998 : (e.minute ?? 0) + (e.added ?? 0) / 100;
  out.sort((a, b) => at(a) - at(b) || a.order - b.order);
  const strip = e => { const rest = {...e}; delete rest.order; return rest; };
  const events = out.filter(e => !e.shootout).map(strip), shootout = out.filter(e => e.shootout).map(strip);
  return {events, shootout, omitted, available: events.length + shootout.length > 0};
}

export const minuteText = e => e.minute == null ? '' : e.added ? `${e.minute}+${e.added}′` : `${e.minute}′`;
