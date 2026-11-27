'use client';
// Compact in-play card (lib/football/inplay.mjs). Shows only unresolved options; pauses on stale or conflicting data.
import LocalTime from './local-time';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- server payload
const pct = (p?: number) => p == null ? '–' : `${Math.round(p * 100)}%`;
const minute = (i: Row) => i?.status === 'HT' ? 'Half-time' : i?.elapsed != null ? `${i.elapsed}′` : '';

function Markets({m, home, away}: {m: Row; home: string; away: string}) {
  const totals = (m.totals ?? []).slice(0, 2);
  return <>
    <div className="intel-stats mt-prob-compact" aria-label="Final result probabilities">
      <div><span>{home}</span><strong>{pct(m.result?.home)}</strong></div><div><span>Draw</span><strong>{pct(m.result?.draw)}</strong></div><div><span>{away}</span><strong>{pct(m.result?.away)}</strong></div>
    </div>
    <ul className="mt-live-markets">
      <li>Another goal <strong>{pct(m.anotherGoal)}</strong></li>
      <li>Next goal: {home} <strong>{pct(m.nextGoal?.home)}</strong> · {away} <strong>{pct(m.nextGoal?.away)}</strong> · none <strong>{pct(m.nextGoal?.none)}</strong></li>
      {totals.map((t: Row) => <li key={t.line}>Over {t.line} goals (full match) <strong>{pct(t.over)}</strong></li>)}
      {m.btts && <li>Both teams to score <strong>{pct(m.btts.yes)}</strong></li>}
    </ul>
  </>;
}

export default function LivePrediction({inplay, home, away}: {inplay: Row | null | undefined; home: string; away: string}) {
  if (!inplay) return null;
  const live = inplay.state === 'live', prev = inplay.previous;
  if (!live && !prev && inplay.state !== 'paused') return null;
  return <section className="intel-panel mt-live-prediction" aria-labelledby="live-pred">
    <div className="mt-panel-head"><h2 id="live-pred" className="mt-card-heading">Live prediction</h2><span className="mt-tag">Provisional</span></div>
    {live ? <>
      <p className="mt-card-meta">Using {inplay.input.home}–{inplay.input.away} at {minute(inplay.input)} · updated <LocalTime fixture={{startsAt: inplay.createdAt}}/> · {inplay.uncertainty} uncertainty</p>
      <Markets m={inplay.markets} home={home} away={away}/>
    </> : <>
      <p className="intel-notice" role="status">{inplay.reason ?? 'Live prediction paused — waiting for fresh data.'}</p>
      {prev?.markets && <details className="mt-details"><summary><span>Previous estimate · {prev.input?.home}–{prev.input?.away} at {minute(prev.input)}</span></summary><Markets m={prev.markets} home={home} away={away}/></details>}
    </>}
    {live && <details className="mt-details"><summary>Details</summary><ul className="mt-supporting">
      <li>Model {inplay.modelVersion}: remaining regulation goals per team are Poisson, using {inplay.baseline?.basis === 'pre-match-forecast' ? 'the saved pre-match forecast' : 'recorded results before kickoff'} for team strength (expected goals {inplay.baseline?.lambda?.map((x: number) => x.toFixed(2)).join(' – ')}), scaled to about {Math.round(inplay.markets.expectedRemainingMinutes)} remaining minutes.</li>
      {inplay.limitations?.map((l: string) => <li key={l}>{l}</li>)}
      <li>Resolved outcomes are not offered. Not included in Top picks or pre-match accuracy.</li>
    </ul></details>}
  </section>;
}
