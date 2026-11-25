'use client';
// Live Scores: in-progress and recently finished matches from Mnemba's stored live feeds (view=live).
// Polls Mnemba (never a provider) every 30 s while visible, backing off after failures; the last good board stays shown.
import {useEffect, useRef, useState} from 'react';
import {FixtureGroups} from './fixture-row';
import {StatePanel} from './mt-ui';

type Fixture = Parameters<typeof FixtureGroups>[0]["fixtures"][number];
type Board = {generatedAt: number; lastUpdate: number | null; state: 'fresh' | 'stale' | 'offline'; live: Fixture[]; delayed?: Fixture[]; finished: Fixture[]; unconfirmed: number; refreshSeconds: number; note: string};
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export default function LiveScores() {
  const [board, setBoard] = useState<Board | null>(null), [failed, setFailed] = useState(0), [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Every 10 s while visible; one request at a time (a new load aborts an obsolete one); paused while hidden and
    // refreshed at once on return; exponential backoff after errors. Reads Mnemba's shared board only.
    let alive = true, failures = 0, inflight: AbortController | null = null;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      inflight?.abort(); const ctl = new AbortController(); inflight = ctl;
      try {
        const r = await fetch('/api/intelligence?view=live', {headers: {accept: 'application/json'}, signal: ctl.signal, cache: 'no-store'});
        if (!r.ok) throw Error(String(r.status));
        const b = await r.json() as Board; if (!alive || ctl.signal.aborted) return;
        setBoard(b); failures = 0; setFailed(0); schedule((b.refreshSeconds ?? 10) * 1000);
      } catch { if (!alive || ctl.signal.aborted) return; failures++; setFailed(failures); schedule(Math.min(300000, 10000 * 2 ** failures)); }
      finally { if (inflight === ctl) inflight = null; }
    };
    const schedule = (ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, ms); };
    const visible = () => { if (document.visibilityState === 'visible') void load(); else { if (timer.current) clearTimeout(timer.current); inflight?.abort(); } };
    void load(); document.addEventListener('visibilitychange', visible);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { alive = false; inflight?.abort(); if (timer.current) clearTimeout(timer.current); clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, []);
  if (!board) return failed ? <StatePanel kind="error" title="Live scores are unavailable">Mnemba could not load live scores. Retrying automatically.</StatePanel> : <StatePanel kind="loading" title="Loading live scores…"/>;
  const updated = board.lastUpdate ? `Feed checked ${ago(now - board.lastUpdate)}` : 'No live update recorded yet';
  return <>
    <p className={`mt-live-status mt-live-${failed ? 'offline' : board.state}`} role="status">
      <span className="mt-live-dot" aria-hidden="true"/>{failed ? 'Connection lost · showing the last scores received' : board.state === 'fresh' ? 'Live' : board.state === 'stale' ? 'Scores may be delayed' : 'Live feed offline'} · {updated}
    </p>
    <section aria-labelledby="live-now"><h2 id="live-now" className="mt-card-heading">Live now <small>{board.live.length}</small></h2>
      {board.live.length ? <FixtureGroups fixtures={board.live}/> : <StatePanel kind="empty" title="No matches in progress">No covered match is being played right now. Recently finished matches are listed below.</StatePanel>}
    </section>
    {(board.delayed?.length ?? 0) > 0 && <section aria-labelledby="delayed"><h2 id="delayed" className="mt-card-heading">Not currently updating <small>{board.delayed!.length}</small></h2>
      <p className="mt-supporting">The feed for these matches has not updated in the last few minutes. The last recorded score is shown; it may be out of date.</p>
      <FixtureGroups fixtures={board.delayed!}/></section>}
    {board.unconfirmed > 0 && <p className="mt-supporting">{board.unconfirmed} {board.unconfirmed === 1 ? 'match' : 'matches'} started more than four hours ago without a confirmed result and {board.unconfirmed === 1 ? 'is' : 'are'} not shown as live.</p>}
    <section aria-labelledby="recent"><h2 id="recent" className="mt-card-heading">Recently finished <small>{board.finished.length}</small></h2>
      {board.finished.length ? <FixtureGroups fixtures={board.finished}/> : <p className="mt-supporting">No match has finished in the last few hours.</p>}
    </section>
    <p className="mt-supporting">{board.note}</p>
  </>;
}
