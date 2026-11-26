'use client';
// AI-written explanation of the saved pre-match forecast. Every point cites recorded facts; numbers come only from them.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- stored payload
export default function AiExplanation({ai}: {ai?: Row | null}) {
  if (!ai?.points?.length) return null;
  const label = new Map((ai.facts ?? []).map((f: Row) => [f.id, `${f.label}: ${f.value}`]));
  return <div className="mt-ai"><p className="mt-label">Explanation · written by Google Gemini from Mnemba’s recorded data</p>
    <ul className="mt-supporting">{ai.points.map((p: Row, i: number) => <li key={i}>{p.text} <small title={p.facts.map((id: string) => label.get(id) ?? id).join('\n')}>({p.facts.length} {p.facts.length === 1 ? 'fact' : 'facts'})</small></li>)}</ul>
    {ai.caveat && <p className="mt-supporting">{ai.caveat}</p>}
    <p className="mt-supporting">An explanation of the estimate, not new evidence. No web search was used.</p></div>;
}
