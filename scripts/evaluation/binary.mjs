// Binary Brier uses (p - y)^2, not the three-class sum used for 1X2.
export function binaryMetrics(rows) {
  if (!rows.length) return {count:0,accuracy:null,brier:null,logLoss:null,calibration:[]};
  let correct=0,tied=0,brier=0,loss=0;
  const bins=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,count:0,predicted:0,observed:0}));
  for (const {probability:p,outcome:y} of rows) {
    if (!Number.isFinite(p)||p<0||p>1||![0,1].includes(y)) throw Error('Invalid binary evaluation row');
    const tie=Math.abs(p-0.5)<1e-12;
    tied+=Number(tie);correct+=Number(!tie&&Number(p>0.5)===y);
    brier+=(p-y)**2;loss-=Math.log(Math.max(y?p:1-p,1e-12));
    const bin=bins[Math.min(9,Math.floor(p*10))];bin.count++;bin.predicted+=p;bin.observed+=y;
  }
  return {count:rows.length,accuracy:rows.length>tied?correct/(rows.length-tied):null,tiedPicks:tied,decisivePicks:rows.length-tied,brier:brier/rows.length,logLoss:loss/rows.length,calibration:bins.filter(b=>b.count).map(b=>({...b,predicted:b.predicted/b.count,observed:b.observed/b.count}))};
}
