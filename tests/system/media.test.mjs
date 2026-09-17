import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../football-db.mjs';
import {safeImage,newsMedia,mediaIdentity} from '../../lib/football/media-policy.mjs';
import {commonsMetadata,saveMedia,mediaFor,checkMediaUrl} from '../../lib/football/media-registry.mjs';
import {parseFeed} from '../../lib/football/news.mjs';
import {articleVideo,safeVideo} from '../../lib/football/media.mjs';
test('canonical IDs and country prevent Barcelona and player name collisions',()=>{
 const barca={id:'team:barca',type:'team',country:'Spain',canonicalId:'spain:barca'};
 assert.equal(mediaIdentity(barca,{entityId:'team:barca',entityType:'team',country:'Spain',canonicalId:'spain:barca'}),true);
 assert.equal(mediaIdentity(barca,{entityId:'team:bsc',entityType:'team',country:'Ecuador'}),false);
 assert.equal(mediaIdentity({id:'wikidata:Q1',type:'player'},{entityId:'wikidata:Q2',entityType:'player'}),false);
});
test('news media uses attributed RSS then permitted OG then video and never stadium art',()=>{
 const url='https://www.bbc.co.uk/sport/a',rss={url:'https://ichef.bbci.co.uk/a.jpg',kind:'rss',articleUrl:url,usageBasis:'RSS',attribution:'BBC'},og={...rss,kind:'opengraph',url:'https://ichef.bbci.co.uk/b.jpg'};
 assert.equal(newsMedia({url,images:[og,rss]}).url,rss.url);assert.equal(newsMedia({url,images:[og]}).url,og.url);
 assert.equal(newsMedia({url,images:[{...rss,articleUrl:'https://other.test'}]}).type,'placeholder');
 assert.equal(newsMedia({url,media:{permission:'publisher-embed',articleUrl:url,thumbnail:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}}).type,'video');
 assert.equal(newsMedia({publisher:'BBC'}).type,'placeholder');
 for(const u of ['javascript:alert(1)','https://evil.test/a.jpg','https://upload.wikimedia.org/a.svg','https://i.ytimg.com/a.jpg?utm_source=x'])assert.equal(safeImage(u),null);
});
test('RSS media preserves source and limits summary; disabled embeds never frame',()=>{
 const x=parseFeed('<rss><item><title>A</title><link>https://www.bbc.co.uk/sport/a</link><pubDate>2026-09-12</pubDate><description>'+('word '.repeat(100))+'</description><media:thumbnail url="https://ichef.bbci.co.uk/a.jpg"/></item></rss>',{publisher:'BBC',hosts:['bbc.co.uk'],url:'https://feeds.bbci.co.uk/rss'},Date.parse('2026-09-13'))[0];assert.equal(x.images.length,1);assert.ok(x.images[0].usageBasis);assert.ok(x.summary.length<=280);
 assert.equal(articleVideo({url:'x',media:{articleUrl:'x',url:'https://youtu.be/abcdefghijk',permission:'disabled'}}),null);assert.match(safeVideo('https://vimeo.com/123456789'),/^https:\/\/player.vimeo.com/);assert.equal(safeVideo('https://evil.test/embed/abcdefghijk'),null);
});
test('Commons metadata needs creator and a supported file license',()=>{const info={url:'https://upload.wikimedia.org/a.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:A.jpg',width:100,height:100,extmetadata:{Artist:{value:'Photographer'},LicenseShortName:{value:'CC BY-SA 4.0'}}};assert.ok(commonsMetadata(info));assert.equal(commonsMetadata({...info,extmetadata:{}}),null);});
test('registry deduplicates URLs, preserves attribution, and backs off broken images',async()=>{const {store,sqlite}=database();try{await store.init();const m={url:'https://upload.wikimedia.org/a.jpg',sourceUrl:'https://commons.wikimedia.org/wiki/File:A.jpg',usageBasis:'CC BY 4.0',attribution:'Creator',lastSuccess:store.now(),width:100,height:100};await saveMedia(store,{id:'a',type:'player'},'portrait',m,'Exact identity');await saveMedia(store,{id:'a',type:'player'},'portrait',m,'Exact identity');assert.equal((await store.one('SELECT COUNT(*) n FROM media_assets')).n,1);assert.equal((await mediaFor(store,['a'])).a.attribution,'Creator');assert.deepEqual(await mediaFor(store,['different-person']),{});let calls=0;const fail=async()=>{calls++;return new Response('',{status:404});};await assert.rejects(checkMediaUrl(store,m.url,fail));await assert.rejects(checkMediaUrl(store,m.url,fail),/backoff/);assert.equal(calls,1);}finally{sqlite.close();}});
test('Commons thumbnails strip source tracking and retain safe raster logo previews',()=>{const info={url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Club.svg',thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Club.svg/320px-Club.svg.png?utm_source=commons.wikimedia.org',descriptionurl:'https://commons.wikimedia.org/wiki/File:Club.svg',thumbwidth:320,thumbheight:320,extmetadata:{Artist:{value:'Club creator'},LicenseShortName:{value:'CC BY-SA 2.5'}}};const m=commonsMetadata(info);assert.ok(m);assert.ok(!m.url.includes('utm_'));assert.ok(m.url.endsWith('.png'));assert.equal(safeImage(info.url),null);});
test('a broken RSS image moves to the next permitted media option',()=>{const url='https://www.bbc.co.uk/sport/a',a={url,images:[{kind:'rss',url:'https://ichef.bbci.co.uk/a.jpg',articleUrl:url,usageBasis:'RSS',attribution:'BBC'},{kind:'opengraph',url:'https://ichef.bbci.co.uk/b.jpg',articleUrl:url,usageBasis:'Permitted metadata',attribution:'BBC'}]};assert.equal(newsMedia(a,[a.images[0].url]).url,a.images[1].url);assert.equal(newsMedia(a,a.images.map(m=>m.url)).type,'placeholder');});

test('network failures persist retry backoff and untested assets are rejected',async()=>{const {store,sqlite}=database();try{await store.init();let calls=0;const fetcher=async()=>{calls++;throw Error('Network timeout');};const url='https://upload.wikimedia.org/timeout.jpg';await assert.rejects(checkMediaUrl(store,url,fetcher),/timeout/);await assert.rejects(checkMediaUrl(store,url,fetcher),/backoff/);assert.equal(calls,1);await assert.rejects(saveMedia(store,{id:'player:a',type:'player'},'portrait',{url,sourceUrl:'https://commons.wikimedia.org/wiki/File:A.jpg',usageBasis:'CC BY 4.0',attribution:'Creator'},'Exact identity'),/Verified load/);}finally{sqlite.close();}});
test('only verified canonical aliases inherit media across provider IDs',async()=>{
 const {store,sqlite}=database();try{await store.init();
 for(const [id,country] of [['barca','Spain'],['bsc','Ecuador']])await store.run('INSERT INTO canonical_entities VALUES(?,?,?,?,?,?,?,?)',id,'team','Barcelona',null,country,null,'{}',store.now());
 for(const [id,canonical,verified] of [['source:barca','barca',1],['alias:barca','barca',1],['unreviewed:barca','barca',0],['source:bsc','bsc',1]])await store.run('INSERT INTO entity_aliases VALUES(?,?,?,?,?,?,?,?)',id,canonical,id,id,'Barcelona','barcelona',verified,'https://example.org/identity');
 const m={url:'https://upload.wikimedia.org/barca.png',sourceUrl:'https://commons.wikimedia.org/wiki/File:Barca.png',usageBasis:'CC BY 4.0',attribution:'Creator',lastSuccess:store.now()};await saveMedia(store,{id:'source:barca',type:'team'},'badge',m,'Verified canonical identity');
 const result=await mediaFor(store,['alias:barca','unreviewed:barca','source:bsc']);assert.equal(result['alias:barca'].url,m.url);assert.equal(result['unreviewed:barca'],undefined);assert.equal(result['source:bsc'],undefined);
 }finally{sqlite.close();}
});
