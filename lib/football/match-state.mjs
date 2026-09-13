const groups={scheduled:['NS','TBD','SCHEDULED','TIMED'],live:['1H','HT','2H','ET','BT','P','LIVE','IN_PLAY'],completed:['FT','FINISHED','AET','PEN'],postponed:['PST','POSTPONED'],cancelled:['CANC','CANCELLED','CANCELED','AWD','WO'],interrupted:['SUSP','INT','SUSPENDED','INTERRUPTED','ABD','ABANDONED','PAUSED']};
export function matchState(f,now=Date.now()){
 const status=String(f.status??'').toUpperCase(),state=Object.keys(groups).find(k=>groups[k].includes(status))??'unknown';
 const dateOnly=f.kickoffPrecision==='date',day=Number.isFinite(f.startsAt)?new Date(f.startsAt).toISOString().slice(0,10):null;
 const stale=state==='scheduled'&&Number.isFinite(f.startsAt)&&(dateOnly?Date.parse(day)+86400000<=now:f.startsAt<=now);
 return{state,status,label:({scheduled:'Scheduled',live:'In progress',completed:'Completed',postponed:'Postponed',cancelled:'Cancelled',interrupted:'Interrupted',unknown:'Status unverified'})[state],dateOnly,needsRefresh:stale,previewAllowed:state==='scheduled',forecastEligible:state==='scheduled'&&!dateOnly&&f.startsAt>now,notice:stale?'The scheduled time has passed without a confirmed status update. Refresh is needed; completion is not assumed.':state==='live'?'Recorded in-progress score. No new in-play probabilities are calculated.':state==='postponed'?'Awaiting a verified revised schedule.':state==='interrupted'?'Play is interrupted; a final result is not confirmed.':dateOnly?'Kickoff time to be confirmed. Published calendar date is preserved.':null};
}
export function analysisCutoff(f,now=Date.now()){
 if(!Number.isFinite(f.startsAt))return now;
 // With no known clock, exclude the whole fixture date to avoid same-day leakage.
 const start=f.kickoffPrecision==='date'?Date.parse(new Date(f.startsAt).toISOString().slice(0,10)):f.startsAt;
 return Math.min(now,start);
}
export const withMatchState=(f,now)=>({...f,label:matchState(f,now).label,lifecycle:matchState(f,now)});
