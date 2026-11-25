'use client';
// Live Scores: in-progress and recently finished matches from Mnemba's stored live feeds (view=live).
// Polls Mnemba (never a provider) every 30 s while visible, backing off after failures; the last good board stays shown.
import {useEffect, useRef, useState} from 'react';
import {FixtureGroups} from './fixture-row';
import {StatePanel} from './mt-ui';

type Fixture = Parameters<typeof FixtureGroups>[0]["fixtures"][number];
type Board = {generatedAt: number; lastUpdate: number | null; state: 'fresh' | 'stale' | 'offline'; live: Fixture[]; finished: Fixture[]; unconfirmed: number; refreshSeconds: number; note: string};
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export default function LiveScores() {
  const [board, setBoard] = useState<Board | null>(null), [failed, setFailed] = useState(0), [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true, failures = 0;
    const load = async () => {
      if (document.visibilityState === 'hidden') { schedule(30000); return; }
      try {
        const r = await fetch('/api/intelligence?view=live', {headers: {accept: 'application/json'}});
        if (!r.ok) throw Error(String(r.status));
        const b = await r.json() as Board; if (!alive) return;
        setBoard(b); failures = 0; setFailed(0); schedule((b.refreshSeconds ?? 30) * 1000);
      } catch { if (!alive) return; failures++; setFailed(failures); schedule(Math.min(300000, 30000 * 2 ** failures)); }
    };
    const schedule = (ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, ms); };
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    void load(); document.addEventListener('visibilitychange', visible);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, []);
  if (!board) return failed ? <StatePanel kind="error" title="Live scores are unavailable">Mnemba could not load live scores. Retrying automatically.</StatePanel> : <StatePanel kind="loading" title="Loading live scores…"/>;
  const updated = board.lastUpdate ? `Updated ${ago(now - board.lastUpdate)}` : 'No live update recorded yet';
  return <>
    <p className={`mt-live-status mt-live-${failed ? 'offline' : board.state}`} role="status">
      <span className="mt-live-dot" aria-hidden="true"/>{failed ? 'Connection lost · showing the last scores received' : board.state === 'fresh' ? 'Live' : board.state === 'stale' ? 'Scores may be delayed' : 'Live feed offline'} · {updated}
    </p>
    <section aria-labelledby="live-now"><h2 id="live-now" className="mt-card-heading">Live now <small>{board.live.length}</small></h2>
      {board.live.length ? <FixtureGroups fixtures={board.live}/> : <StatePanel kind="empty" title="No matches in progress">No covered match is being played right now. Recently finished matches are listed below.</StatePanel>}
    </section>
    {board.unconfirmed > 0 && <p className="mt-supporting">{board.unconfirmed} {board.unconfirmed === 1 ? 'match' : 'matches'} started more than four hours ago without a confirmed result and {board.unconfirmed === 1 ? 'is' : 'are'} not shown as live.</p>}
    <section aria-labelledby="recent"><h2 id="recent" className="mt-card-heading">Recently finished <small>{board.finished.length}</small></h2>
      {board.finished.length ? <FixtureGroups fixtures={board.finished}/> : <p className="mt-supporting">No match has finished in the last few hours.</p>}
    </section>
    <p className="mt-supporting">{board.note}</p>
  </>;
}
