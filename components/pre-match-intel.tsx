'use client';
// Pre-match research (OpenAI web search): lineups, availability and circumstances, each with its cited source as an
// inline clickable link (required when showing web results). Context only: probabilities are not changed by it.
import LocalTime from './local-time';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- stored research record
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };
const Src = ({url}: {url?: string | null}) => url ? <a className="mt-cite" href={url} target="_blank" rel="noopener noreferrer">{host(url)}</a> : null;
const STATUS: Record<string, string> = {confirmed: 'Confirmed lineup', predicted: 'Predicted lineup', not_announced: 'Lineup not yet announced'};
export default function PreMatchIntel({research, home, away}: {research?: Row | null; home: string; away: string}) {
  if (!research) return null;
  const lu = research.lineup ?? {}, side = (t: string) => t === 'home' ? home : away;
  return <section className="intel-panel mt-research" aria-labelledby="research-title">
    <div className="mt-panel-head"><h2 id="research-title" className="mt-card-heading">Team news</h2><span className="mt-tag">{STATUS[lu.status] ?? 'Lineup not yet announced'}</span></div>
    <p className="mt-card-meta">Checked <LocalTime fixture={{startsAt: research.verifiedAt}}/> · web research with cited sources · does not change the probabilities</p>
    {['confirmed', 'predicted'].includes(lu.status) && <div className="mt-lineups">{(['home', 'away'] as const).map(t => <div key={t}><strong>{side(t)}{lu[t]?.formation ? ` · ${lu[t].formation}` : ''}</strong>
      <p className="mt-supporting">{(lu[t]?.starters ?? []).map((p: Row) => `${p.number != null ? p.number + ' ' : ''}${p.name}`).join(', ') || 'Not listed'}</p></div>)}
      <p className="mt-supporting">{lu.status === 'predicted' ? 'Predicted, not official. ' : ''}Source: <Src url={lu.source}/></p></div>}
    {research.availability?.length > 0 && <ul className="mt-availability">{research.availability.map((a: Row, i: number) => <li key={i}><strong>{a.player}</strong> ({side(a.team)}) · {a.status.replace('_', ' ')}{a.detail ? ` — ${a.detail}` : ''} <Src url={a.source}/></li>)}</ul>}
    {research.circumstances?.length > 0 && <ul className="mt-availability">{research.circumstances.map((c: Row, i: number) => <li key={i}>{c.detail} <Src url={c.source}/></li>)}</ul>}
    {!['confirmed', 'predicted'].includes(lu.status) && !research.availability?.length && !research.circumstances?.length && <p className="mt-supporting">No sourced team news found yet.</p>}
  </section>;
}
