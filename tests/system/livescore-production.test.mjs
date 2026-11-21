import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database} from '../football-db.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {liveTick,liveSnapshot} from '../../lib/football/live.mjs';
import {parseLiveScoreDiscovery,normalizeLiveScore,parseLiveScoreIncidents,parseLiveScoreLineups} from '../../lib/football/livescore.mjs';
const sample=name=>JSON.parse(readFileSync(new URL(`../fixtures/livescore/${name}.json`,import.meta.url)));
const config={compactTimestampTimezone:'UTC'};
test('captured discovery and scoreboard agree on identity, UTC kickoff and clock',()=>{
 const fixtures=parseLiveScoreDiscovery(sample('discovery'),config);assert.equal(fixtures.length,2);
 const board=sample('scoreboard'),f=normalizeLiveScore(board,board.Stg,config);
 assert.equal(f.id,fixtures[0].id);assert.equal(f.startsAt,fixtures[0].startsAt);assert.equal(f.startsAt,Date.parse('2026-09-24T14:00:00Z'));
 assert.equal(f.elapsed,84);assert.equal(f.status,'2H');assert.equal(fixtures[1].status,'1H');assert.equal(f.homeScore,2);
});
test('captured incidents preserve two goals by the same player and lineups identify starters',()=>{
 const f=parseLiveScoreDiscovery(sample('discovery'),config)[0],body=sample('incidents');body.Incs['1'].push({...body.Incs['1'][0]});
 const incidents=parseLiveScoreIncidents(body,f);assert.equal(incidents.length,3);assert.equal(incidents.filter(r=>r.player==='Eldor Shomurodov').length,2);
 const teams=parseLiveScoreLineups(sample('lineups'),f);assert.equal(teams.length,2);assert.equal(teams[0].formation,'4-2-3-1');assert.deepEqual(teams.map(t=>t.players.filter(p=>p.started).length),[11,11]);
 assert.ok(teams.every(t=>t.players.every(p=>p.position!=='COACH')));
});
test('real captured responses persist additively through the worker and final-match detail tasks',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-24T15:44:00Z');await store.init();
 const calls=[];const service=new IntelligenceService(store,{MNEMBA_LIVESCORE_ENABLED:'1'},{sleep:async()=>{},fetcher:async url=>{const path=new URL(url).pathname;calls.push(path);return Response.json(sample(path.includes('/live/')?'discovery':path.split('/')[4]));}});await service.initialize();
 try{
  const first=await liveTick(service,{cadenceMs:0});assert.equal(first.state,'success');assert.equal(first.raw,2);assert.equal(first.accepted,2);assert.equal(first.persisted,2);
  assert.equal((await store.one("SELECT COUNT(*) n FROM fixture_identities WHERE fixture_id LIKE 'livescore:%'")).n,2);
  // Select the real international match for the representative vertical slice.
  await store.run("UPDATE fixtures SET starts_at=? WHERE id='livescore:1881159'",store.now()-2*86400000);
  for(let i=0;i<3;i++)assert.equal((await liveTick(service,{cadenceMs:0})).state,'success');
  const state=await liveSnapshot(store,'livescore:1894365');assert.equal(state.fixture.homeScore,2);assert.equal(state.details.fixture_events.length,3);assert.equal(state.details.lineups.length,2);
  const original=JSON.parse((await store.one("SELECT payload FROM fixtures WHERE id='livescore:1894365'")).payload);original.status='FT';await store.run("UPDATE fixtures SET status='FT',payload=? WHERE id=?",JSON.stringify(original),original.id);
  await store.run("DELETE FROM football_cache WHERE id LIKE 'live:poll:%'");
  assert.equal((await liveTick(service,{cadenceMs:0})).state,'success');assert.ok(calls.some(p=>p.includes('/lineups/')));
 }finally{sqlite.close();}
});
test('real unpublished detail envelopes preserve data and defer only that match task',async()=>{
 const {store,sqlite}=database();store.now=()=>Date.parse('2026-09-24T15:44:00Z');await store.init();
 const raw=sample('discovery'),service=new IntelligenceService(store,{MNEMBA_LIVESCORE_ENABLED:'1'},{sleep:async()=>{},fetcher:async url=>{const path=new URL(url).pathname;return Response.json(path.includes('/live/')?raw:path.includes('/incidents/')?{}:sample('scoreboard'));}});await service.initialize();
 try{
  assert.equal((await liveTick(service,{cadenceMs:0})).state,'success');
  await store.run("UPDATE fixtures SET starts_at=? WHERE id='livescore:1881159'",store.now()-2*86400000);
  await store.putCache('live:poll:selected:livescore:1894365',{at:store.now()},600000);
  await store.upsert('fixture_events',{fixture_id:'livescore:1894365',label:'Live',payload:'[{"type":"Goal"}]',updated_at:store.now()});
  const result=await liveTick(service,{cadenceMs:0});assert.equal(result.state,'unavailable');assert.equal(result.fixtureId,'livescore:1894365');
  assert.equal(await store.cache('live:backoff:livescore'),null);assert.ok(await store.cache('live:poll:events:livescore:1894365'));
  assert.equal((await store.one("SELECT payload FROM fixture_events WHERE fixture_id='livescore:1894365'")).payload,'[{"type":"Goal"}]');
  const {LiveScoreAdapter}=await import('../../lib/football/livescore.mjs');
  for(const body of [{},{Eid:'1894365'}]){const a=new LiveScoreAdapter({json:async()=>body},{MNEMBA_LIVESCORE_ENABLED:'1'});await assert.rejects(a.checkedDetail('incidents','1894365'),{name:'LiveScoreDetailUnavailable'});}
  const wrong=new LiveScoreAdapter({json:async()=>({Eid:'different',Incs:{}})},{MNEMBA_LIVESCORE_ENABLED:'1'});await assert.rejects(wrong.checkedDetail('incidents','1894365'),/identity mismatch/);
 }finally{sqlite.close();}
});
