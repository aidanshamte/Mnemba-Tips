'use client';
// NBA centre from recorded BALLDONTLIE data and the basketball model (bball-elo-1). No demonstration data.
import {useEffect, useState} from 'react';
import SiteNav from './site-nav';
import LocalTime from './local-time';
import {StatePanel} from './mt-ui';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API payload
const pct = (p?: number) => p == null ? '–' : `${Math.round(p * 100)}%`;

export function GameRow({g}: {g: Row}) {
  const scored = g.homeScore != null && g.awayScore != null, p = g.prediction;
  return <a className="mt-fixture-row" href={`/basketball/game/${encodeURIComponent(g.id)}`}>
    <span className="mt-fixture-when"><LocalTime fixture={{startsAt: g.startsAt, kickoffPrecision: g.timeKnown ? 'instant' : 'date'}}/>{g.status !== 'NS' && <span className={`mt-tag mt-status-${g.status === 'FT' ? 'finished' : g.status === 'HT' ? 'halftime' : g.status === 'LIVE' ? 'live' : 'postponed'}`}>{g.status === 'FT' ? 'Final' : g.label}</span>}
      {g.status === 'NS' && p?.winner && <span className="mt-analysis-chip mt-analysis-full">{p.winner.home >= 0.5 ? g.home.abbreviation : g.away.abbreviation} {pct(Math.max(p.winner.home, p.winner.away))}</span>}</span>
    <span className="mt-fixture-team mt-fixture-home"><span className="mt-team-name mt-clamp-2">{g.home.name}</span></span>
    <span className="mt-fixture-score" aria-label={scored ? `Score ${g.homeScore} to ${g.awayScore}` : undefined}>{scored ? `${g.homeScore} : ${g.awayScore}` : 'vs'}</span>
    <span className="mt-fixture-team mt-fixture-away"><span className="mt-team-name mt-clamp-2">{g.away.name}</span></span>
  </a>;
}

export default function BasketballCentre() {
  const [data, setData] = useState<Row | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const r = await fetch('/api/intelligence?view=basketball', {cache: 'no-store'}); if (!r.ok) throw Error(String(r.status)); const j = await r.json() as Row; if (alive) { setData(j); setError(''); } }
      catch { if (alive) setError('Basketball data is temporarily unavailable.'); }
      if (alive) timer = setTimeout(load, document.visibilityState === 'visible' ? 30000 : 120000);
    };
    void load(); return () => { alive = false; clearTimeout(timer); };
  }, []);
  const ev = data?.evaluation;
  return <div className="intel"><SiteNav active="basketball"/><main className="intel-main">
    <section className="intel-heading"><div className="intel-eyebrow">BASKETBALL</div><h1>NBA</h1><p>Scores, schedules and model estimates from recorded NBA results. Not official league data.</p></section>
    {error && <div className="intel-notice" role="status">{error}</div>}
    {!data ? <StatePanel kind="loading" title="Loading basketball…"/> : !data.configured && !data.historicalGames ? <StatePanel kind="empty" title="Basketball data is not connected yet">The NBA data source needs its access key before games can be shown. Nothing on this page is invented in the meantime.</StatePanel> : <>
      <p className="mt-summary">{data.lastSync ? <>Schedule checked <LocalTime fixture={{startsAt: data.lastSync}}/></> : 'Not yet synchronised'}{data.liveCheckedAt ? <> · live scores checked <LocalTime fixture={{startsAt: data.liveCheckedAt}}/></> : null} · {data.historicalGames.toLocaleString()} recorded games</p>
      {data.live.length > 0 && <section aria-labelledby="bb-live"><h2 id="bb-live" className="mt-card-heading">Live <small>{data.live.length}</small></h2><div className="mt-fixture-group">{data.live.map((g: Row) => <GameRow key={g.id} g={g}/>)}</div></section>}
      <section aria-labelledby="bb-up"><h2 id="bb-up" className="mt-card-heading">Next 48 hours <small>{data.upcoming.length}</small></h2>
        {data.upcoming.length ? <div className="mt-fixture-group">{data.upcoming.map((g: Row) => <GameRow key={g.id} g={g}/>)}</div> : <p className="mt-supporting">No NBA games recorded in the next 48 hours.</p>}</section>
      <section aria-labelledby="bb-recent"><h2 id="bb-recent" className="mt-card-heading">Recent results</h2>
        {data.recent.length ? <div className="mt-fixture-group">{data.recent.map((g: Row) => <GameRow key={g.id} g={g}/>)}</div> : <p className="mt-supporting">No recent results recorded.</p>}</section>
      {data.standings.length > 0 && <section aria-labelledby="bb-table"><h2 id="bb-table" className="mt-card-heading">Standings · {data.season}–{String((data.season + 1) % 100).padStart(2, '0')}</h2><p className="mt-supporting">Computed from recorded regular-season results.</p>
        <div className="mt-bb-standings">{data.standings.map((c: Row) => <div key={c.conference} className="table-scroll"><table><caption>{c.conference}</caption><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Pct</th></tr></thead>
          <tbody>{c.rows.map((r: Row, i: number) => <tr key={r.id}><td>{i + 1}</td><td>{r.name}</td><td>{r.w}</td><td>{r.l}</td><td>{r.pct.toFixed(3).replace(/^0/, '')}</td></tr>)}</tbody></table></div>)}</div></section>}
      {ev?.state === 'evaluated' && <section className="intel-panel" aria-labelledby="bb-eval"><h2 id="bb-eval" className="mt-card-heading">How the model has performed</h2>
        <p className="mt-supporting">Tested on {ev.winner.n.toLocaleString()} games from {ev.testSeasons.join(', ')} that it had not seen (fitted on {ev.trainSeason} only): picked the winner {pct(ev.winner.accuracy)} of the time; Brier score {ev.winner.brier.toFixed(3)}; average miss on the margin {ev.marginMae.toFixed(1)} points and on the total {ev.totalMae.toFixed(1)} points.</p></section>}
      <p className="mt-supporting">{data.note}</p>
    </>}
  </main></div>;
}
