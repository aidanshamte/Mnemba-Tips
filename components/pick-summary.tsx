import {matchPick} from '@/lib/football/confidence.mjs';
type Analysis={probabilities?:number[];factors?:Record<string,unknown>;estimateKind?:string};
type Side={name:string};
const pct=(x:number)=>Math.round(x*100);
/** Primary match-result pick: who, how likely, measured-confidence tier, and the full home/draw/away split as a bar. */
export default function PickSummary({analysis,fixture}:{analysis?:Analysis|null;fixture:{home:Side;away:Side}}){
 const pick=matchPick(analysis,fixture);if(!pick||!analysis?.probabilities)return null;const p=analysis.probabilities;
 return <div className="pick-summary">
  <div className="pick-line"><span className="pick-name">{pick.pick}</span><strong className="pick-pct">{pct(pick.probability)}%</strong></div>
  <span className={`pick-conf pick-conf-${pick.tier}`}>{pick.label}</span>
  <div className="pick-bar" role="img" aria-label={`Home ${pct(p[0])}%, draw ${pct(p[1])}%, away ${pct(p[2])}%`}>{p.map((x,i)=><span key={i} className={`pick-seg pick-seg-${i}${i===pick.outcome?' is-pick':''}`} style={{flexGrow:x}}/>)}</div>
  <div className="pick-legend" aria-hidden="true"><span>Home {pct(p[0])}%</span><span>Draw {pct(p[1])}%</span><span>Away {pct(p[2])}%</span></div>
 </div>;
}
