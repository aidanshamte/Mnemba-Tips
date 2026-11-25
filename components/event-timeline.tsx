'use client';
// Chronological match events from documented provider fields only (lib/football/events.mjs).
import {matchTimeline, minuteText} from '@/lib/football/events.mjs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- provider rows
const ICON: Record<string, string> = {goal: '⚽', 'own-goal': '⚽', 'penalty-goal': '⚽', 'shootout-scored': '⚽', yellow: '🟨', 'second-yellow': '🟨', red: '🟥', 'missed-penalty': '✕', substitution: '⇄', var: 'VAR', disallowed: 'VAR', period: '', 'shootout-result': ''};
function Item({e, home, away}: {e: Row; home?: string; away?: string}) {
  const team = e.side === 'home' ? home : e.side === 'away' ? away : e.teamName;
  return <li className={`mt-event mt-event-${e.kind}${e.side ? ` mt-event-${e.side}` : ''}${e.disallowed ? ' mt-event-disallowed' : ''}`}>
    <span className="mt-event-minute">{minuteText(e)}</span>
    <span className="mt-event-icon" aria-hidden="true">{ICON[e.kind] ?? ''}</span>
    <span className="mt-event-text"><strong>{e.label}</strong>{e.player ? ` · ${e.player}` : ''}{e.related ? ` · ${e.related}` : ''}{team && e.kind !== 'period' ? <small> {team}</small> : null}
      {e.score?.home != null ? <small> ({e.score.home}–{e.score.away})</small> : null}</span>
  </li>;
}
export default function EventTimeline({rows, fixture}: {rows: unknown; fixture: Row}) {
  const t = matchTimeline(rows as Row[], fixture) as {events: Row[]; shootout: Row[]; omitted: number; available: boolean}, home = fixture?.home?.name, away = fixture?.away?.name;
  return <section className="intel-panel mt-timeline" aria-labelledby="events-title"><h2 id="events-title" className="mt-card-heading">Match events</h2>
    {t.available ? <ol className="mt-event-list">{t.events.map(e => <Item key={e.id} e={e} home={home} away={away}/>)}</ol> : <p>Match events unavailable from this source.</p>}
    {t.shootout.length > 0 && <><h3 className="mt-label">Penalty shoot-out</h3><ol className="mt-event-list">{t.shootout.map(e => <Item key={e.id} e={e} home={home} away={away}/>)}</ol></>}
    {t.available && <p className="mt-supporting">Minutes as supplied by the source. Scorers are shown only when the source names them.{t.omitted ? ` ${t.omitted} provider ${t.omitted === 1 ? 'entry' : 'entries'} of an undocumented type ${t.omitted === 1 ? 'is' : 'are'} not shown.` : ''}</p>}
  </section>;
}
