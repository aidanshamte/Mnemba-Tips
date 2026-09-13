import {calendarDay,dayBounds,validZone} from './timezone.mjs';
export const addDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
export function matchdayRange(params,now=Date.now()){
 const zone=params.get('timezone')??'UTC';if(!validZone(zone))throw Error('Invalid timezone');
 const mode=params.get('day')??(params.has('from')?'custom':'today'),today=calendarDay(now,zone);let from=today,to=today;
 if(mode==='yesterday')from=to=addDays(today,-1);else if(mode==='tomorrow')from=to=addDays(today,1);else if(mode==='week')to=addDays(today,6);else if(mode==='weekend'){const weekday=new Date(today).getUTCDay();from=weekday===0?addDays(today,-1):addDays(today,(6-weekday+7)%7);to=addDays(from,1);}else if(['date','custom'].includes(mode)){from=params.get('from')??today;to=mode==='date'?from:params.get('to')??from;}else if(mode!=='today')throw Error('Invalid matchday');
 if(from>to||Date.parse(to)-Date.parse(from)>31*86400000)throw Error('Choose an ordered range of at most 32 days');
 return{mode,from,to,zone,start:dayBounds(from,zone).start,end:dayBounds(to,zone).end,explanation:mode==='weekend'?'Saturday and Sunday; on Sunday includes the current Saturday.':mode==='today'||mode==='tomorrow'?'Relative to your selected timezone.':'Calendar dates remain fixed in shared links.'};
}
export function inMatchday(f,range){return f.kickoffPrecision==='date'?new Date(f.startsAt).toISOString().slice(0,10)>=range.from&&new Date(f.startsAt).toISOString().slice(0,10)<=range.to:f.startsAt>=range.start&&f.startsAt<range.end;}
