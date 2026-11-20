// Fixture-only counters: team/season writes must not inflate ingestion health.
export async function ingestFixtureBatch(service,provider,request,read){
 const report={provider,request,attempted:true,raw:0,normalized:0,rejected:0,deduplicated:0,inserted:0,updated:0,unchanged:0,persisted:0,state:'success',errors:[]};
 const previous=service.store.fixtureWriteStats;service.store.fixtureWriteStats=report;
 try{
  const rows=await read(report);report.normalized=rows.length;
  const unique=[...new Map(rows.map(f=>[f.id,f])).values()];report.deduplicated=rows.length-unique.length;
  const existing=new Map();
  for(let i=0;i<unique.length;i+=100){const ids=unique.slice(i,i+100).map(f=>f.id);for(const row of await service.store.all(`SELECT id,payload FROM fixtures WHERE id IN (${ids.map(()=>'?').join(',')})`,...ids))existing.set(row.id,row.payload);}
  const changed=unique.filter(f=>existing.get(f.id)!==JSON.stringify(f));
  const unchanged=unique.filter(f=>existing.get(f.id)===JSON.stringify(f));report.unchanged=unchanged.length;
  // Refresh observation time without regrading the entire forecast archive for unchanged schedules.
  for(let i=0;i<unchanged.length;i+=100){const ids=unchanged.slice(i,i+100).map(f=>f.id);await service.store.run(`UPDATE fixtures SET updated_at=? WHERE id IN (${ids.map(()=>'?').join(',')})`,service.store.now(),...ids);}
  if(changed.length)await service.saveFixtures(changed);
  report.state=report.rejected?'partial':rows.length?'success':'empty';
 }catch(error){report.state='error';report.errors.push(`${provider}${request.file?': '+request.file:''}: ${error.message}`);}
 finally{service.store.fixtureWriteStats=previous;report.persisted=report.inserted+report.updated+report.unchanged;}
 return report;
}

export async function fixtureInventory(store){
 const start=Date.parse(store.day()),end=start+7*86400000;
 const rows=await store.all("SELECT f.provider,COUNT(*) records,COUNT(DISTINCT COALESCE(i.canonical_id,f.id)) canonical FROM fixtures f LEFT JOIN fixture_identities i ON i.fixture_id=f.id WHERE f.starts_at>=? AND f.starts_at<? GROUP BY f.provider",start,end);
 const future=await store.one("SELECT COUNT(DISTINCT COALESCE(i.canonical_id,f.id)) n FROM fixtures f LEFT JOIN fixture_identities i ON i.fixture_id=f.id WHERE f.starts_at>=? AND f.status IN ('NS','TBD','SCHEDULED','TIMED')",store.now());
 const current=await store.one('SELECT COUNT(DISTINCT COALESCE(i.canonical_id,f.id)) n FROM fixtures f LEFT JOIN fixture_identities i ON i.fixture_id=f.id WHERE f.starts_at>=? AND f.starts_at<?',start,end);
 return{from:store.day(),to:new Date(end-1).toISOString().slice(0,10),current:current.n,future:future.n,providers:rows};
}

export function ingestionHealth(reports,inventory,recent=[]){
 const active=reports.filter(r=>r.attempted),errors=reports.flatMap(r=>r.errors??[]);
 const totals=Object.fromEntries(['raw','normalized','rejected','deduplicated','inserted','updated','unchanged','persisted'].map(key=>[key,reports.reduce((n,r)=>n+(r[key]??0),0)]));
 const reasons=[];
 if(!active.length&&!reports.some(r=>['cached','unchanged'].includes(r.state)))reasons.push('No fixture providers attempted');
 if(errors.length||totals.rejected)reasons.push('Provider errors or rejected records');
 if(active.length&&!totals.persisted&&!active.some(r=>r.state==='cached'||r.state==='unchanged'))reasons.push('No fixtures accepted or confirmed unchanged');
 const baseline=recent.filter(r=>r.current>0).map(r=>r.current).sort((a,b)=>a-b),median=baseline.length?baseline[Math.floor(baseline.length/2)]:null;
 if(baseline.length>=3&&inventory.current<median*.25)reasons.push('Seven-day canonical inventory is below 25% of the recent median; check source coverage and calendar changes');
 const contributing=inventory.providers.filter(p=>p.canonical>0).map(p=>p.provider);
 if(contributing.length<2)reasons.push('Seven-day inventory currently comes from fewer than two providers');
 return{state:reasons.length?'degraded':'healthy',reasons,providersAttempted:[...new Set(active.map(r=>r.provider))],providersSucceeded:[...new Set(active.filter(r=>['success','cached','unchanged'].includes(r.state)).map(r=>r.provider))],...totals,inventory,baselineMedian:median,errors};
}

export async function recordIngestionHealth(store,kind,reports){
 const inventory=await fixtureInventory(store),history=(await store.cache('fixture-ingestion-history'))?.data??[];
 const health=ingestionHealth(reports,inventory,history);
 const sample={day:store.day(),current:inventory.current,future:inventory.future};
 await store.putCache('fixture-ingestion-history',[...history.filter(r=>r.day!==sample.day).slice(-13),sample],30*86400000);
 const report={at:store.now(),kind,...health,providers:reports};
 await store.putCache(kind==='fixtures'?'fixture-ingestion-health':`fixture-ingestion-health:${kind}`,report,2*86400000);
 console.log('mnemba_fixture_ingestion',JSON.stringify({kind,state:report.state,raw:report.raw,normalized:report.normalized,inserted:report.inserted,updated:report.updated,rejected:report.rejected,current:inventory.current,future:inventory.future,reasons:report.reasons}));
 return report;
}
