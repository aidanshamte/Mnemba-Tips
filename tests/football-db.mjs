import { DatabaseSync } from 'node:sqlite';
import { Store } from '../lib/football/store.mjs';
export function database(path=':memory:') {
  const sqlite=new DatabaseSync(path); sqlite.exec('PRAGMA foreign_keys=ON');
  const adapt=(sql,args=[])=>({bind:(...values)=>adapt(sql,values),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{const result=sqlite.prepare(sql).run(...args);return {meta:{changes:result.changes}};}});
  const db={prepare:sql=>adapt(sql),batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return {db,sqlite,store:new Store(db)};
}
export const apiCompetition={league:{id:777,name:'Regional Cup',type:'Cup'},country:{name:'Ghana',code:'GH'},seasons:[{year:2026,current:true,start:'2026-01-01',end:'2026-12-31',coverage:{fixtures:{events:true,lineups:true,statistics_fixtures:true},injuries:true,standings:true}}]};
export const apiFixture=(id=1,status='NS',date='2026-09-11T12:00:00Z',home=10,away=20)=>({fixture:{id,date,status:{short:status,elapsed:status==='1H'?23:null},venue:{name:'Local ground'}},league:{...apiCompetition.league,country:'Ghana',season:2026},teams:{home:{id:home,name:`Team ${home}`},away:{id:away,name:`Team ${away}`}},goals:{home:status==='NS'?null:2,away:status==='NS'?null:1}});
export const fdFixture={id:1,utcDate:'2026-09-11T12:00:00Z',status:'TIMED',competition:{id:2000,name:'Example competition',type:'CUP'},area:{id:2001,name:'Europe',code:'EUR'},season:{id:23,startDate:'2026-01-01',endDate:'2026-12-31'},homeTeam:{id:10,name:'Home'},awayTeam:{id:20,name:'Away'},score:{fullTime:{home:null,away:null}}};
