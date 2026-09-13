// All probabilities come from the same joint regulation-time score distribution.
export function settleGoals(home,away,{kind,side='home',line=0}){
 if(!Number.isInteger(home)||!Number.isInteger(away)||home<0||away<0)throw Error('Nonnegative integer scores required');
 let difference;
 if(kind==='handicap')difference=(side==='home'?home-away:away-home)+line;
 else if(kind==='total')difference=(side==='home'?home:side==='away'?away:home+away)-line;
 else throw Error('Unsupported settlement');
 return difference>0?'win':difference===0?'push':'loss';
}
export function goalMarkets(cells){
 const total=cells.reduce((n,c)=>n+c.probability,0);
 if(Math.abs(total-1)>1e-6||cells.some(c=>!Number.isFinite(c.probability)||c.probability<0))throw Error('Normalized score distribution required');
 const sum=fn=>cells.filter(fn).reduce((n,c)=>n+c.probability,0),home=sum(c=>c.home>c.away),draw=sum(c=>c.home===c.away),away=sum(c=>c.home<c.away);
 const totals=side=>[.5,1.5,2,2.5,3.5].map(line=>({line,over:sum(c=>settleGoals(c.home,c.away,{kind:'total',side,line})==='win'),push:sum(c=>settleGoals(c.home,c.away,{kind:'total',side,line})==='push'),under:sum(c=>settleGoals(c.home,c.away,{kind:'total',side,line})==='loss')}));
 return{scope:'Regulation time plus stoppage time; excludes extra time and penalties. Postponed/abandoned matches are not settled here. Integer lines return the stake on a push. No bookmaker odds or combined-bet probabilities.',result:{home,draw,away},doubleChance:{homeOrDraw:home+draw,awayOrDraw:away+draw,homeOrAway:home+away},drawNoBet:{home:{win:home,push:draw,loss:away},away:{win:away,push:draw,loss:home}},btts:{yes:sum(c=>c.home>0&&c.away>0),no:sum(c=>c.home===0||c.away===0)},totals:totals('both'),teamTotals:{home:totals('home'),away:totals('away')},handicap:[-1.5,-1,0,1,1.5].map(line=>({line,win:sum(c=>settleGoals(c.home,c.away,{kind:'handicap',side:'home',line})==='win'),push:sum(c=>settleGoals(c.home,c.away,{kind:'handicap',side:'home',line})==='push'),loss:sum(c=>settleGoals(c.home,c.away,{kind:'handicap',side:'home',line})==='loss')})),correctScores:[...cells].sort((a,b)=>b.probability-a.probability).slice(0,12)};
}
