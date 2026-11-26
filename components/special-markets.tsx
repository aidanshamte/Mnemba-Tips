'use client';
// Corners and cards (provisional, special-nb-1): shown inside Analysis details; never a Top pick.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- stored forecast payload
const pct = (p: number) => `${Math.round(p * 100)}%`;
function Family({label, m}: {label: string; m?: Row}) {
  if (!m) return null;
  if (m.withheld) return <li>{label}: not estimated — {m.withheld}</li>;
  const mid = m.totals[Math.floor(m.totals.length / 2)];
  return <li>{label}: expected {m.expected[0].toFixed(1)} – {m.expected[1].toFixed(1)}; over {mid.line} total {pct(mid.over)} ({m.sample.home}/{m.sample.away} recorded matches){m.definition ? `. ${m.definition}` : ''}</li>;
}
export default function SpecialMarkets({special}: {special?: Row}) {
  if (!special) return null;
  return <div className="mt-special"><p className="mt-label">Corners and cards · provisional</p><ul className="mt-supporting">
    <Family label="Corners" m={special.corners}/><Family label="Cards" m={special.cards}/>
    <li>Own count models from recorded counts; excluded from Top picks until their evaluation criteria pass.</li></ul></div>;
}
