import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {database} from '../tests/football-db.mjs';
import {populatedLocalDatabase} from './local-database.mjs';
import {routeToken} from '../lib/football/consumer.mjs';
const origin=process.argv[2]??'http://localhost:5173';if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Identity fixtures are local-only');
let store,sqlite,pool;if(process.env.DATABASE_URL){if(process.env.MNEMBA_DATABASE_SCHEMA!=='local_verified')throw Error('Only isolated verification schema permitted');const {createPool,postgresDatabase}=await import('../lib/azure/postgres.mjs');const {Store}=await import('../lib/football/store.mjs');pool=createPool();store=new Store(postgresDatabase(pool));}else({store,sqlite}=database(populatedLocalDatabase()));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');const browser=await chromium.launch({headless:true,env:process.env});
const out='.sites-runtime/visual-identities/browser';mkdirSync(out,{recursive:true});const evidence=[];
try{
 const fixtures=await store.all('SELECT f.payload FROM fixtures f JOIN competitions c ON c.id=f.competition_id ORDER BY f.starts_at DESC');
 const catalog=await fetch(origin+'/api/intelligence?view=catalog').then(r=>r.json());const competitions=new Map(catalog.competitions.flatMap(c=>(c.providerIds??[c.id]).map(id=>[id,c])));
 const parsed=fixtures.map(r=>{const f=JSON.parse(r.payload);return {...f,competition:{...f.competition,...competitions.get(f.competition.id)}};});
 const cases=[['Tanzania',f=>f.competition.country?.name==='Tanzania'],['Premier League',f=>f.competition.country?.name==='England'&&/Premier League/.test(f.competition.name)],['La Liga',f=>f.competition.country?.name==='Spain'&&/Primera|La Liga/.test(f.competition.name)],['Bundesliga',f=>f.competition.country?.name==='Germany'&&/^Bundesliga/.test(f.competition.name)],['Serie A',f=>f.competition.country?.name==='Italy'&&/^Serie A/.test(f.competition.name)],['Champions League',f=>/Champions League/.test(f.competition.name)],['MLS',f=>/Major League Soccer|MLS/.test(f.competition.name)]];
 let example;
 for(const [label,accept] of cases){const f=parsed.find(accept);assert.ok(f,`${label} fixture required`);example??=f;
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/football/match/'+routeToken(f.id),{waitUntil:'domcontentloaded'});await page.locator('.match-score').waitFor({timeout:90000});
  assert.equal(await page.locator('.match-score .identity-badge').count(),2);
  assert.ok(await page.locator('.match-hero .competition-visual').count());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');assert.deepEqual(errors,[]);
  if(label==='Tanzania')assert.equal(await page.locator('.match-score .identity-badge').first().evaluate(e=>getComputedStyle(e).color),'rgb(180, 229, 211)');
  if(label==='Tanzania')await page.screenshot({path:out+'/tanzania-mobile.png'});
  evidence.push({label,teamBadges:2,competitionBadge:true,errors});console.log('PASS',label);await page.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(origin+'/football/coverage',{waitUntil:'domcontentloaded'});await page.locator('tbody tr').first().waitFor({timeout:90000});assert.ok(await page.locator('summary').filter({hasText:'CAF Champions League'}).locator('.competition-visual').count());evidence.push({label:'CAF',coverageFallback:true});await page.screenshot({path:out+'/coverage-desktop.png'});await page.close();
 // Synthetic permission metadata and image responses remain inside the test browser.
 for(const mode of ['loaded','broken','timeout']){
  const page=await browser.newPage();let metadataRequests=0;
  const url='https://upload.wikimedia.org/mnemba-test.png',visual={logoUrl:url,sourceUrl:'https://commons.wikimedia.org/wiki/File:Mnemba-test.png',source:'Commons test fixture',licenseOrPermission:'CC0 1.0',attribution:'Synthetic test',verified:true,lastCheckedAt:Date.now(),sourceEntityId:example.home.id};
  await page.route('**/api/intelligence?view=visuals',route=>{metadataRequests++;return route.fulfill({json:{team:{[example.home.id]:visual,[example.away.id]:visual},competition:{}}});});
  await page.route(url,async route=>{if(mode==='broken')return route.abort();if(mode==='timeout')await new Promise(r=>setTimeout(r,12000));try{await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE9sAAAAASUVORK5CYII=','base64')});}catch{}});
  await page.goto(origin+'/football/match/'+routeToken(example.id),{waitUntil:'domcontentloaded'});await page.locator('.match-score').waitFor({timeout:90000});
  if(mode==='loaded')await page.locator('.match-score .has-real-badge').first().waitFor({timeout:20000});
  else{await page.waitForTimeout(mode==='timeout'?9000:1500);assert.equal(await page.locator('.match-score .has-real-badge').count(),0);assert.equal(await page.locator('.match-score .mnemba-fallback svg').count(),2);assert.equal(await page.locator('.match-score img').count(),0);}
  assert.equal(metadataRequests,1,'One shared metadata request for every badge');evidence.push({mode,metadataRequests});await page.close();
 }
 writeFileSync(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log('PASS regional identities, CAF fallback, cleared-image preference, broken/timeout fallback and deduplicated metadata');
}finally{await browser.close();sqlite?.close();await pool?.end();}
