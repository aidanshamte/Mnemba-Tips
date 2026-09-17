"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, BrainCircuit, ChevronDown, Circle, CircleDot, Database, Search, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { matchups, sources } from "@/lib/demo-data.mjs";
import { formScore, predictMatch, projectLineup } from "@/lib/prediction-engine.mjs";

type Sport = "soccer" | "basketball";

function TeamMark({ team }: { team: any }) {
  return <span className="team-mark" style={{ background: `linear-gradient(145deg, ${team.colors[0]}, ${team.colors[1]})` }}>{team.short.slice(0, 2)}</span>;
}

function FormStrip({ form }: { form: string[] }) {
  return <div className="form-strip" aria-label={`Recent form ${form.join(", ")}`}>{form.map((result, index) => <span key={`${result}-${index}`} className={`form-dot ${result.toLowerCase()}`}>{result}</span>)}</div>;
}

function ProbabilityBar({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <div className="probability-row"><div><span>{label}</span><strong>{value}%</strong></div><div className="track"><span className={accent ? "accent" : ""} style={{ width: `${value}%` }} /></div></div>;
}

export default function Home({initialSport = "soccer"}: {initialSport?: Sport}) {
  const [sport, setSport] = useState<Sport>(initialSport);
  const [selectedId, setSelectedId] = useState(matchups.find((m: any) => m.sport === initialSport)!.id);
  const [query, setQuery] = useState("");
  const filtered = matchups.filter((m: any) => m.sport === sport && `${m.home.name} ${m.away.name}`.toLowerCase().includes(query.toLowerCase()));
  const match: any = matchups.find((m: any) => m.id === selectedId && m.sport === sport) || filtered[0] || matchups.find((m: any) => m.sport === sport);
  const prediction: any = useMemo(() => predictMatch(match), [match]);
  const homeLineup: any[] = useMemo(() => projectLineup(match.home.players, sport), [match, sport]);
  const awayLineup: any[] = useMemo(() => projectLineup(match.away.players, sport), [match, sport]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: any }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(context.registerTool({
      name: "analyze_matchup",
      title: "Analyze matchup",
      description: "Select a Mnemba Tips matchup and return its probability projection and lineup model.",
      inputSchema: { type: "object", properties: { matchupId: { type: "string", enum: matchups.map((m: any) => m.id) } }, required: ["matchupId"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: ({ matchupId }: { matchupId: string }) => {
        const selected: any = matchups.find((m: any) => m.id === matchupId);
        if (!selected) throw new Error("Unknown matchup");
        setSport(selected.sport); setSelectedId(selected.id);
        return { matchup: `${selected.home.name} vs ${selected.away.name}`, prediction: predictMatch(selected) };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const changeSport = (next: Sport) => {
    setSport(next);
    const first: any = matchups.find((m: any) => m.sport === next);
    setSelectedId(first.id);
    setQuery("");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Target size={21} /></span><div><strong>Mnemba Tips</strong><small>AI Studio</small></div></div>
        <nav aria-label="Primary navigation">
          <button className="nav-item active"><BrainCircuit size={18} /> Prediction Lab</button>
          <a className="nav-item" href="/football"><Activity size={18} /> Global Football</a>
          <a className="nav-item" href="/football?view=search"><Users size={18} /> Teams & Players</a>
          <a className="nav-item" href="/football?view=diagnostics"><BarChart3 size={18} /> Model Accuracy</a>
          <a className="nav-item" href="/football?view=diagnostics"><Database size={18} /> Data Sources</a>
        </nav>
        <div className="system-card"><div><span className="pulse" /> Analytics engine</div><strong>Operational</strong><small>Historical mode · transparent estimates</small></div>
        <div className="version">v3.0 · Open-data build</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">MULTI-SPORT INTELLIGENCE</p><h1>Prediction Lab</h1></div>
          <div className="source-status"><ShieldCheck size={17} /><span>Open data</span><strong>3 sources ready</strong></div>
        </header>

        <div className="sport-switch" role="tablist" aria-label="Sport">
          <button role="tab" aria-selected={sport === "soccer"} className={sport === "soccer" ? "selected" : ""} onClick={() => changeSport("soccer")}><CircleDot size={17} /> Soccer</button>
          <button role="tab" aria-selected={sport === "basketball"} className={sport === "basketball" ? "selected" : ""} onClick={() => changeSport("basketball")}><Circle size={17} /> Basketball</button>
        </div>

        <p role="note" style={{padding:16,background:"#f5be45",color:"#10233d",fontWeight:800}}>Demo data · Model scenarios for football and basketball. These are not live fixtures.</p><section className="match-picker">
          <div className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a team" aria-label="Search a team" /></div>
          <div className="match-tabs">
            {filtered.map((item: any) => <button key={item.id} className={item.id === match.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.home.short}</span><em>vs</em><span>{item.away.short}</span></button>)}
          </div>
        </section>

        <section className="prediction-hero">
          <div className="match-heading">
            <div className="team home"><TeamMark team={match.home} /><div><h2>{match.home.name}</h2><FormStrip form={match.home.form} /></div></div>
            <div className="versus"><span>{match.competition}</span><strong>VS</strong><small>{match.kickoff}</small></div>
            <div className="team away"><div><h2>{match.away.name}</h2><FormStrip form={match.away.form} /></div><TeamMark team={match.away} /></div>
          </div>
          <div className="prediction-grid">
            <div className="score-call"><span>MODEL SCORE</span><strong>{prediction.projectedScore}</strong><div><Sparkles size={14} /> {prediction.confidence}% confidence</div></div>
            <div className="probabilities">
              <ProbabilityBar label={match.home.short} value={prediction.home} accent={prediction.home >= prediction.away} />
              {sport === "soccer" && <ProbabilityBar label="Draw" value={prediction.draw} />}
              <ProbabilityBar label={match.away.short} value={prediction.away} accent={prediction.away > prediction.home} />
            </div>
            <div className="model-metrics">
              {sport === "soccer" ? <><div><span>Expected goals</span><strong>{prediction.expectedGoals[0]} — {prediction.expectedGoals[1]}</strong></div><div><span>Both teams score</span><strong>{prediction.btts}%</strong></div><div><span>Over 2.5 goals</span><strong>{prediction.over25}%</strong></div></> : <><div><span>Projected total</span><strong>{prediction.total}</strong></div><div><span>Home win</span><strong>{prediction.home}%</strong></div><div><span>Away win</span><strong>{prediction.away}%</strong></div></>}
            </div>
          </div>
        </section>

        <div className="content-grid">
          <section className="panel lineups-panel">
            <div className="panel-title"><div><p>PROJECTED STARTERS</p><h3>{sport === "soccer" ? "Probable lineups" : "Projected starting five"}</h3></div><span className="model-badge">Model-generated</span></div>
            <div className="lineup-columns">
              {[{ team: match.home, lineup: homeLineup }, { team: match.away, lineup: awayLineup }].map(({ team, lineup }) => <div key={team.name} className="lineup"><div className="lineup-team"><TeamMark team={team} /><strong>{team.short}</strong><span>{lineup.length} selected</span></div>{lineup.map((player: any, index: number) => <div className="player" key={player.id}><b>{index + 1}</b><div><strong>{player.name}</strong><span>{player.position} · form {player.form}</span></div><em>{Math.round(player.lineupScore)}%</em></div>)}</div>)}
            </div>
            <p className="disclaimer">Projected from recent starts, player form and recorded availability. This is not a confirmed team sheet.</p>
          </section>

          <div className="side-stack">
            <section className="panel">
              <div className="panel-title"><div><p>HEAD TO HEAD</p><h3>Last {match.h2h.games} meetings</h3></div><ChevronDown size={18} /></div>
              <div className="h2h-score"><div><strong>{match.h2h.homeWins}</strong><span>{match.home.short} wins</span></div>{sport === "soccer" && <div><strong>{match.h2h.draws}</strong><span>Draws</span></div>}<div><strong>{match.h2h.awayWins}</strong><span>{match.away.short} wins</span></div></div>
              <div className="history">{match.h2h.recent.map((result: string) => <span key={result}>{result}</span>)}</div>
            </section>
            <section className="panel reasons">
              <div className="panel-title"><div><p>WHY THIS CALL</p><h3>Model reasoning</h3></div><BrainCircuit size={20} /></div>
              <ol>{prediction.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ol>
            </section>
            <section className="panel form-card">
              <div className="panel-title"><div><p>FORM INDEX</p><h3>Recent momentum</h3></div></div>
              {[match.home, match.away].map((team: any) => <div key={team.name} className="form-index"><span>{team.short}</span><div><i style={{ width: `${formScore(team.form) * 100}%` }} /></div><strong>{Math.round(formScore(team.form) * 100)}</strong></div>)}
            </section>
          </div>
        </div>

        <section className="sources-section"><div><p className="eyebrow">DATA PROVENANCE</p><h2>Built to ingest open records</h2></div><div className="sources-grid">{sources.map((source: any) => <article key={source.name}><Database size={18} /><div><strong>{source.name}</strong><span>{source.use}</span><small>{source.license}</small></div><em>{source.state}</em></article>)}</div><p className="source-note">Displayed matchups are clearly marked model scenarios. Production connectors normalize licensed open datasets into the same team, match, player and appearance schema.</p></section>
      </section>
    </main>
  );
}
