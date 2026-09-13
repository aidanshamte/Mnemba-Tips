const scope='90 minutes plus stoppage time; excludes extra time and shootouts';
const supported=[['result','1X2'],['double-chance','Double chance'],['draw-no-bet','Draw no bet'],['total','Match / team goal totals'],['btts','Both teams to score (GG / NG)'],['correct-score','Correct score'],['exact-goals','Exact goals'],['goal-range','Goal ranges'],['winning-margin','Winning margin'],['clean-sheet','Team clean sheet'],['win-to-nil','Win to nil'],['odd-even','Goal odd/even'],['european-handicap','European three-way handicap'],['asian-handicap','Asian two-way handicap'],['result-btts','Result and BTTS'],['result-total','Result and total goals']];
const explanatory=[['home-away-no-bet','Home no bet / away no bet','Exact operator settlement definition'],['halves','Half results, totals, BTTS, handicaps; HT/FT and both halves','Joint first/second-half history and validated period model'],['corners','Corner totals, 1X2, handicap, ranges, exact totals and first/last corner','Corner counts and ordered event history'],['bookings','Cards, booking points, sending off and first booking','Card events; operator rules for second yellow and red; points distinct from counts'],['players','Scorers, assists, shots, saves, fouls, offsides, passes, tackles and cards','Player identity, participation/minutes, confirmed XI and relevant event history'],['match-path','First/last goal, time windows, consecutive goals, leading and comeback','Timestamped event-path model; final scores are insufficient'],['statistics','Shots, shots on target, fouls, offsides, tackles, goal kicks and throw-ins','Statistic-specific historical counts and validated model'],['specials','1UP, 2UP, Never Down, Early Goals','Current operator-specific eligibility and settlement rules; no universal definition'],['accumulators','Multi-match accumulators','Defensible cross-match dependence model; never multiply correlated selections']];
export const MARKET_REGISTRY=[...supported.map(([id,name])=>({id,name,period:'regulation',participant:'match or selected team',line:['total','asian-handicap','european-handicap'].includes(id)?'explicit line required':null,requiredData:'Team scoring/conceding results before cutoff',modelSupport:'provisional-score-distribution',availability:'calculated when eligible goal model exists',scope,settlement:'Win/loss; push on integer equality where applicable; quarter lines split equally; void if regulation result unavailable'})),...explanatory.map(([id,name,requiredData])=>({id,name,period:'requires explicit period',participant:'market-specific',line:null,requiredData,modelSupport:'unsupported',availability:'explanatory only',scope:'Operator/period rules must be verified',settlement:'Unpriced; no active recommendation'}))];
const result=(h,a)=>h>a?'home':h<a?'away':'draw';
const binary=v=>v?'win':'loss';
const sign=n=>n>0?'win':n<0?'loss':'push';
function splitLine(line){if(!Number.isFinite(line)||Math.abs(line*4-Math.round(line*4))>1e-8)throw Error('Whole, half or quarter line required');return Math.abs(line*2-Math.round(line*2))<1e-8?[line]:[line-.25,line+.25];}
function combine(states){if(states.length===1||states[0]===states[1])return states[0];if(states.includes('push'))return states.includes('win')?'half-win':'half-loss';return 'push';}
export function settleMarket(option,h,a,{status='FT',period='regulation'}={}){
 if(period!=='regulation'||!['FT','FINISHED'].includes(status))return ['CANC','CANCELLED','AWD','WO'].includes(status)?'void':'pending';
 if(![h,a].every(n=>Number.isInteger(n)&&n>=0))return 'pending';
 const {market,selection,side='both',line=0}=option,total=side==='home'?h:side==='away'?a:h+a,r=result(h,a);
 switch(market){
 case 'result':return binary(r===selection);
 case 'double-chance':return binary(({ '1X':['home','draw'],X2:['away','draw'],'12':['home','away']}[selection]??[]).includes(r));
 case 'draw-no-bet':return r==='draw'?'push':binary(r===selection);
 case 'total':return combine(splitLine(line).map(l=>sign((total-l)*(selection==='under'?-1:1))));
 case 'btts':return binary((h>0&&a>0)===(selection==='yes'));
 case 'correct-score':return binary(h===option.home&&a===option.away);
 case 'exact-goals':return binary(total===line);
 case 'goal-range':return binary(total>=option.min&&total<=option.max);
 case 'winning-margin':return binary((side==='away'?a-h:h-a)===line);
 case 'clean-sheet':return binary((side==='home'?a:h)===0);
 case 'win-to-nil':return binary(side==='home'?h>0&&a===0:a>0&&h===0);
 case 'odd-even':return binary(total%2===(selection==='odd'?1:0));
 case 'european-handicap':if(!Number.isInteger(line))throw Error('European handicap requires integer line');return binary(result(h+line,a)===selection);
 case 'asian-handicap':return combine(splitLine(line).map(l=>sign((side==='away'?a-h:h-a)+l)));
 case 'result-btts':return binary(r===selection&&(h>0&&a>0)===option.btts);
 case 'result-total':return binary(r===selection&&((h+a)>line)===(option.over!==false));
 default:throw Error('Unsupported market cannot be priced');
 }
}
export function priceMarket(cells,option){const p={win:0,loss:0,push:0,'half-win':0,'half-loss':0};for(const c of cells)p[settleMarket(option,c.home,c.away)]+=c.probability;return p;}
export function marketOptions(){return[
 ...['home','draw','away'].map(selection=>({market:'result',selection,label:`${selection} win${selection==='draw'?' / draw':''}`})),
 ...['1X','X2','12'].map(selection=>({market:'double-chance',selection,label:selection})),
 ...['home','away'].map(selection=>({market:'draw-no-bet',selection,label:`${selection} draw no bet`})),
 ...['yes','no'].map(selection=>({market:'btts',selection,label:`Both teams score: ${selection}`})),
 ...['both','home','away'].flatMap(side=>[1.5,2,2.25,2.5,2.75,3.5].flatMap(line=>['over','under'].map(selection=>({market:'total',side,line,selection,label:`${side==='both'?'Match':side} ${selection} ${line} goals`})) )),
 ...[-1.5,-1,-.75,-.5,-.25,0,.25,.5,.75,1,1.5].map(line=>({market:'asian-handicap',side:'home',line,label:`Home Asian handicap ${line}`})),
 ...['home','draw','away'].map(selection=>({market:'european-handicap',selection,line:-1,label:`Home -1 three-way: ${selection}`})),
 ...['home','away'].flatMap(side=>['clean-sheet','win-to-nil'].map(market=>({market,side,label:`${side} ${market.replaceAll('-',' ')}`}))),
 ...['odd','even'].map(selection=>({market:'odd-even',selection,label:`Total goals ${selection}`})),
 ...[0,1,2,3,4,5].map(line=>({market:'exact-goals',line,label:`Exactly ${line} goals`})),
 {market:'goal-range',min:2,max:3,label:'2–3 total goals'},
 ...['home','away'].flatMap(side=>[1,2,3].map(line=>({market:'winning-margin',side,line,label:`${side} wins by ${line}`}))),
 ...[0,1,2,3].flatMap(home=>[0,1,2,3].map(away=>({market:'correct-score',home,away,label:`${home}–${away}`}))),
 ...['home','draw','away'].flatMap(selection=>[{market:'result-btts',selection,btts:true,label:`${selection} and both score`},{market:'result-total',selection,line:2.5,over:true,label:`${selection} and over 2.5`}])
 ];}
export {scope as MARKET_SCOPE};
