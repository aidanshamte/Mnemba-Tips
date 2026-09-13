import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayBounds,calendarDay,formatKickoff} from '../../lib/football/timezone.mjs';
import {internalAccess,publicViews,sameOrigin} from '../../lib/football/access.mjs';
import {safeVideo,articleVideo} from '../../lib/football/media.mjs';
import {badgeUrl,membershipAt,badgeName} from '../../lib/football/public-enrichment.mjs';
import {deriveTable} from '../../lib/football/consumer.mjs';
import {database} from '../football-db.mjs';
import {globalSearch} from '../../lib/football/search.mjs';
test('local days and DST boundaries differ correctly between viewers',()=>{
 const at=Date.parse('2026-03-29T00:30:00Z');assert.equal(calendarDay(at,'America/New_York'),'2026-03-28');assert.equal(calendarDay(at,'Africa/Dar_es_Salaam'),'2026-03-29');assert.match(formatKickoff({startsAt:at},'Africa/Dar_es_Salaam'),/03:30/);
 for(const [day,zone,hours] of [['2026-03-08','America/New_York',23],['2026-11-01','America/New_York',25],['2026-03-29','Europe/London',23],['2026-10-25','Europe/London',25],['2026-03-29','Africa/Dar_es_Salaam',24]]){const b=dayBounds(day,zone);assert.equal((b.end-b.start)/3600000,hours);assert.equal(calendarDay(b.start,zone),day);assert.equal(calendarDay(b.end-1,zone),day);}
 assert.equal(formatKickoff({startsAt:at,kickoffPrecision:'date'},'America/New_York'),'2026-03-29 · Kickoff time to be confirmed');assert.throws(()=>dayBounds('2026-01-01','invalid'));
});
test('localhost and forged identity headers do not authorize internal controls',()=>{
 const token='a'.repeat(64);for(const view of ['sources','files','diagnostics','evidence','social','performance'])assert.equal(publicViews.has(view),false);
 assert.equal(internalAccess(new Request('http://localhost/api/intelligence',{headers:{'oai-authenticated-user-id':'forged'}}),token),false);
 assert.equal(internalAccess(new Request('http://localhost/api/intelligence',{headers:{Authorization:'Bearer '+token}}),token),true);
 assert.equal(internalAccess(new Request('http://localhost'),''),false);assert.equal(sameOrigin(new Request('http://localhost',{headers:{Origin:'https://evil.example'}})),false);
 for(const route of ['app/lab/page.tsx','app/football/admin/page.tsx','app/football/classic/page.tsx'])assert.match(readFileSync(route,'utf8'),/redirect\('\/football'\)/);
});
test('video players require approved URLs and association with the exact article',()=>{
 assert.ok(safeVideo('https://www.youtube.com/watch?v=abcdefghijk').startsWith('https://www.youtube-nocookie.com/embed/'));
 for(const url of ['javascript:alert(1)','https://evil.example/embed/abcdefghijk','https://www.youtube.com.evil.example/watch?v=abcdefghijk','https://www.bbc.com/sport/foo','https://user@www.youtube.com/embed/abcdefghijk'])assert.equal(safeVideo(url),null);
 assert.equal(articleVideo({url:'https://publisher/story',media:{permission:'publisher-embed',articleUrl:'https://publisher/other',url:'https://youtu.be/abcdefghijk'}}),null);
});
test('badge URLs are constrained and membership requires bounded dated evidence',()=>{
 assert.notEqual(badgeName('Barcelona SC'),badgeName('FC Barcelona'));assert.equal(badgeName('Arsenal FC'),badgeName('Arsenal'));
 assert.ok(badgeUrl('https://r2.thesportsdb.com/images/media/team/badge/a.png'));assert.equal(badgeUrl('https://evil.example/a.png'),null);
 assert.equal(membershipAt({start:100,end:200},150),true);assert.equal(membershipAt({start:100,end:200},200),false);assert.equal(membershipAt({start:100},150),false);
});
test('season opener cannot produce alphabetical all-zero standings',()=>{
 const f={home:{id:'h',name:'Home'},away:{id:'a',name:'Away'},startsAt:100,status:'FT',homeScore:1,awayScore:0};assert.deepEqual(deriveTable([f],100),[]);assert.equal(deriveTable([f],101)[0].points,3);
});
test('player identity is searchable without a team or statistics, with accents and typos',async()=>{
 const {store,sqlite}=database();try{await store.init();await store.upsert('football_players',{id:'verified:player',provider:'verified',external_id:'player',team_id:null,name:'Kylian Mbappé',payload:JSON.stringify({name:'Kylian Mbappé',aliases:['Mbappé']}),updated_at:store.now()});
 for(const q of ['Mbappe','Mbappé','Mbape']){const data=await globalSearch(store,new URLSearchParams({q,kind:'player'}));assert.equal(data.results[0].id,'verified:player');assert.match(data.results[0].url,/\/football\/player\/id-/);}
 }finally{sqlite.close();}
});

test('publisher video feeds reject unsafe XML and unrelated channels',async()=>{const {videoEntries}=await import('../../lib/football/video-news.mjs');assert.throws(()=>videoEntries('<!DOCTYPE feed>',Date.now()),/Unsafe/);assert.deepEqual(videoEntries('<entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>unverified</yt:channelId><title>Story</title><published>2026-09-12T00:00:00Z</published></entry>',Date.parse('2026-09-12T01:00:00Z')),[]);});
