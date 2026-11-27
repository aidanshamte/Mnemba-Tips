import {pickLabel} from '@/lib/football/pick-label.mjs';
type Option={market:string;selection?:string;line?:number;label?:string;probabilities:{win:number}};
export type Recommendation={primary?:Option|null;alternatives?:Option[];reason?:string;ruleVersion?:string}|null|undefined;
type Side={name:string};
const pct=(x:number)=>Math.round(x*100);
/**
 * The selected recommendation (shared selector, any qualifying market), not automatically the largest 1X2
 * probability. An estimated chance is not measured accuracy, so no confidence tier is attached to it.
 */
export default function PickSummary({recommendation,fixture,compact=false}:{recommendation:Recommendation;fixture:{home:Side;away:Side};compact?:boolean}){
 const p=recommendation?.primary;
 if(!p)return <p className="pick-none">No qualifying pick yet</p>;
 const alts=(recommendation?.alternatives??[]).slice(0,2);
 return <div className="pick-summary">
  <div className="pick-line"><span className="pick-name">{pickLabel(p,fixture)}</span><strong className="pick-pct">{pct(p.probabilities.win)}%</strong></div>
  <p className="pick-chance">Estimated chance {pct(p.probabilities.win)}%</p>
  {!compact&&alts.length>0&&<p className="pick-alts">Also: {alts.map(o=>`${pickLabel(o,fixture)} ${pct(o.probabilities.win)}%`).join(' · ')}</p>}
 </div>;
}
