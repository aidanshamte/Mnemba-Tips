import {localOrigin} from './local-origin.mjs';
// Local app journeys. Playwright handles navigation and isolated browser contexts.
// Real external media is observed; the broken-image check is isolated in browser routing.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
let driver;
try{driver=await import('playwright');}catch{
 const entry=(process.env.PATH??'').split(delimiter).map(p=>resolve(p,'../playwright/index.mjs')).find(existsSync);
 if(!entry)throw Error('Run npm run test:browser to provide the pinned Playwright driver.');driver=await import(pathToFileURL(entry).href);
}
const origin=await localOrigin();
const libraries=resolve('.sites-runtime/browser-libs/root/usr/lib/x86_64-linux-gnu');
const browser=await driver.chromium.launch({headless:true,...(process.env.MNEMBA_TEST_BROWSER?{executablePath:process.env.MNEMBA_TEST_BROWSER}:{}),env:{...process.env,...(existsSync(libraries)?{LD_LIBRARY_PATH:libraries+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')}:{})}});

const {writeFileSync}=await import('node:fs');const {routeToken}=await import('../lib/football/consumer.mjs');mkdirSync('outputs/media',{recursive:true});
const report={origin,search:[],news:[],errors:[],simulated:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 async function fits(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');}
 for(const q of ['FC Augsburg','Arsenal','FC Barcelona','Barcelona SC','Bayern München','Messi','Mbappe','Salah']){
  const kind=['Messi','Mbappe','Salah'].includes(q)?'player':'team';await page.goto(origin+'/football/search?kind='+kind+'&q='+encodeURIComponent(q));await page.locator('a[role=option]').first().waitFor();await page.waitForTimeout(500);await fits();
  const items=await page.locator('a[role=option]').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,images:[...n.querySelectorAll('img')].map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>0,alt:i.alt})),fallback:!!n.querySelector('.monogram-shield,.avatar-initials')})));assert.ok(items.every(i=>i.images.some(im=>im.loaded)||i.fallback),'Every search result needs a loaded image or clear fallback');report.search.push({q,items});await page.screenshot({path:'outputs/media/search-'+q.replaceAll(' ','-')+'.png'});
 }
 const barca=report.search.find(r=>r.q==='FC Barcelona'),bsc=report.search.find(r=>r.q==='Barcelona SC');const urls=barca.items.flatMap(i=>i.images.map(m=>m.src));assert.ok(!bsc.items.flatMap(i=>i.images.map(m=>m.src)).some(u=>urls.includes(u)),'Barcelona clubs must not share assigned image');
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/football/search?kind=player&q=Messi');await page.locator('a[role=option]').first().waitFor();await fits();await page.screenshot({path:'outputs/media/search-mobile.png',fullPage:true});
 await page.goto(origin+'/football?tab=News');await page.locator('.news-card').first().waitFor();await page.waitForTimeout(1000);assert.equal(await page.locator('.news-card img[src*="football-night"]').count(),0);await fits();await page.screenshot({path:'outputs/media/news-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'outputs/media/news-desktop.png'});report.news=await page.locator('.news-card').evaluateAll(nodes=>nodes.slice(0,12).map(n=>({headline:n.querySelector('h3')?.textContent,src:n.querySelector('img')?.src,loaded:(n.querySelector('img')?.naturalWidth??0)>0,placeholder:!!n.querySelector('.publisher-placeholder')})));
 const response=await fetch(origin+'/api/intelligence?view=news'),news=await response.json();const video=news.articles.find(a=>a.media?.thumbnail&&a.media.permission==='publisher-embed');assert.ok(video);await page.goto(origin+'/football/news/'+routeToken(video.id));await page.getByRole('button',{name:'Play publisher video',exact:true}).click();await page.locator('iframe').waitFor();await page.waitForTimeout(4000);const frame=page.frames().find(f=>/youtube-nocookie/.test(f.url()));report.video={original:video.url,embed:await page.locator('iframe').getAttribute('src'),body:await frame?.locator('body').innerText().catch(()=> 'Frame inaccessible'),playback:await frame?.locator('video').evaluate(v=>({time:v.currentTime,paused:v.paused})).catch(()=>null)};await page.screenshot({path:'outputs/media/video-desktop.png'});
 const fixtures=await(await fetch(origin+'/api/intelligence?view=fixtures')).json();const f=fixtures.fixtures[0];await page.setViewportSize({width:390,height:844});await page.goto(origin+'/football/match/'+encodeURIComponent(f.id));await page.getByRole('heading',{name:'Match prediction'}).waitFor();assert.equal(await page.locator('details[open]').count(),0);await fits();await page.screenshot({path:'outputs/media/match-mobile.png',fullPage:true});
 // Deterministic broken-image responses remain browser-only.
 const original=await(await fetch(origin+'/api/intelligence?view=global-search&kind=team&q=Arsenal')).json();await page.route('**/api/intelligence?view=badges',r=>r.fulfill({json:{badges:{[original.results[0].id]:{url:'https://www.thesportsdb.com/images/media/team/badge/broken.png'}}}}));await page.route('**/broken.png',r=>r.fulfill({status:404,body:''}));await page.goto(origin+'/football/search?kind=team&q=Arsenal');await page.locator('.monogram-shield').first().waitFor();report.simulated.push('Broken badge -> monogram; no database mutation');
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));writeFileSync('outputs/media/browser.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
