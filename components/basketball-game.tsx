'use client';
// NBA game centre: score by quarter, pre-game estimate (and its grade), recent form, head-to-head, home/away records.
import {useEffect, useState} from 'react';
import SiteNav from './site-nav';
import LocalTime from './local-time';
import {StatePanel} from './mt-ui';
import PreMatchIntel from './pre-match-intel';
import AiExplanation from './ai-explanation';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API payload
const pct = (p?: number) => p == null ? '–' : `${Math.round(p * 100)}%`;

export default function BasketballGame({id}: {id: string}) {
  const [d, setD] = useState<Row | null>(null), [error, setError] = useState('');
  useEffect(() => { let alive = true, t: ReturnType<typeof setTimeout>;
    const load = async () => { try { const r = await fetch(`/api/intelligence?view=basketball-game&id=${encodeURIComponent(id)}`, {cache: 'no-store'}); if (!r.ok) throw Error(); const j = await r.json() as Row; if (alive) setD(j); } catch { if (alive) setError('Game data is temporarily unavailable.'); } if (alive) t = setTimeout(load, 30000); };
    void load(); return () => { alive = false; clearTimeout(t); }; }, [id]);
  const g = d?.game, p = d?.prediction;
  const quarters = g ? [...(g.quarters?.home ?? []).map((_: unknown, i: number) => `Q${i + 1}`), ...(g.overtime?.home ?? []).map((_: unknown, i: number) => `OT${i + 1}`)] : [];
  return <div className="intel"><SiteNav active="basketball"/><main className="intel-main match-center">
    {error && <div className="intel-notice" role="status">{error}</div>}
    {!d ? <StatePanel kind="loading" title="Loading game…"/> : d.unavailable ? <StatePanel kind="empty" title="Game not found">This game is not in the recorded NBA schedule.</StatePanel> : <>
      <section className="intel-panel"><p className="mt-card-meta">NBA · <LocalTime fixture={{startsAt: g.startsAt, kickoffPrecision: g.timeKnown ? 'instant' : 'date'}}/> · {g.status === 'FT' ? 'Final' : g.status === 'NS' ? 'Scheduled' : g.label}</p>
        <h1 className="mt-card-heading">{g.home.name} <span className="mt-supporting">v</span> {g.away.name}</h1>
        {g.homeScore != null && <p className="match-score-line"><strong>{g.homeScore} – {g.awayScore}</strong></p>}
        {quarters.length > 0 && g.quarters.home.some((v: number | null) => v != null) && <div className="table-scroll"><table><thead><tr><th>Team</th>{quarters.map(q => <th key={q}>{q}</th>)}<th>T</th></tr></thead>
          <tbody>{(['home', 'away'] as const).map(side => <tr key={side}><td>{g[side].abbreviation}</td>{[...g.quarters[side], ...g.overtime[side]].map((v: number | null, i: number) => <td key={i}>{v ?? '–'}</td>)}<td>{side === 'home' ? g.homeScore : g.awayScore}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="intel-panel prediction-center"><h2 className="mt-card-heading">Pre-game estimate</h2>
        {p ? <><p className="mt-card-meta">Saved <LocalTime fixture={{startsAt: p.createdAt}}/> · model {p.model}</p>
          <div className="intel-stats mt-prob-compact"><div><span>{g.home.abbreviation} win</span><strong>{pct(p.winner.home)}</strong></div><div><span>{g.away.abbreviation} win</span><strong>{pct(p.winner.away)}</strong></div></div>
          <ul className="mt-live-markets"><li>Margin ({g.home.abbreviation} minus {g.away.abbreviation}) <strong>{p.margin.expected.toFixed(1)}</strong> (range {p.margin.range[0]} to {p.margin.range[1]})</li>
            <li>Total points <strong>{p.total.expected.toFixed(0)}</strong> (range {p.total.range[0]}–{p.total.range[1]})</li>
            <li>Team points: {g.home.abbreviation} <strong>{p.teamTotals.home.expected.toFixed(0)}</strong> · {g.away.abbreviation} <strong>{p.teamTotals.away.expected.toFixed(0)}</strong></li>
            {p.firstHalf && <li>First-half total <strong>{p.firstHalf.total.expected.toFixed(0)}</strong> · {g.home.abbreviation} leads at half-time {pct(p.firstHalf.homeLeads)}</li>}
            {(p.context?.backToBack?.home || p.context?.backToBack?.away) && <li>Back-to-back: {[p.context.backToBack.home && g.home.abbreviation, p.context.backToBack.away && g.away.abbreviation].filter(Boolean).join(', ')} (context only)</li>}</ul>
          {d.grade && <p className="mt-supporting">Result: {d.grade.winnerCorrect ? 'winner called correctly' : 'winner missed'}; margin off by {Math.abs(d.grade.marginError).toFixed(1)}, total off by {Math.abs(d.grade.totalError).toFixed(1)} points.</p>}
          <p className="mt-supporting">{p.note}</p></> : <p>No pre-game estimate was saved for this game{g.status === 'NS' ? ' yet' : ''}. Estimates need recorded games for both teams and are only saved before tip-off.</p>}
      </section>
      <PreMatchIntel research={d.research} home={g.home.name} away={g.away.name}/>
      {d.aiExplanation && <section className="intel-panel"><AiExplanation ai={d.aiExplanation}/></section>}
      <section className="intel-panel"><h2 className="mt-card-heading">Recent form</h2><div className="mt-lineups">{(['home', 'away'] as const).map(side => <div key={side}><strong>{g[side].name}</strong>
        <ul className="mt-availability">{d.form[side].length ? d.form[side].map((x: Row) => <li key={x.id}>{x.for > x.against ? 'W' : 'L'} {x.for}–{x.against} {x.home ? 'v' : '@'} {x.opponent}</li>) : <li>No recorded games before this one.</li>}</ul></div>)}</div>
        <p className="mt-supporting">This season: {g.home.abbreviation} at home {d.homeRecord.w}–{d.homeRecord.l} · {g.away.abbreviation} away {d.awayRecord.w}–{d.awayRecord.l}</p></section>
      <section className="intel-panel"><h2 className="mt-card-heading">Head-to-head</h2>{d.headToHead.length ? <ul className="mt-availability">{d.headToHead.map((x: Row) => <li key={x.id}><LocalTime fixture={{startsAt: x.startsAt, kickoffPrecision: 'date'}}/> · {x.home.abbreviation} {x.homeScore}–{x.awayScore} {x.away.abbreviation}</li>)}</ul> : <p className="mt-supporting">No recorded meetings.</p>}</section>
      <p className="mt-supporting">NBA data from BALLDONTLIE (not official league data). Starting fives and injuries appear only from cited web research; player statistics are not available on the free data plan.</p>
    </>}
  </main></div>;
}
