import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {routeToken} from '../../lib/football/consumer.mjs';
const origin=process.argv[2];
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname)||process.env.MNEMBA_DATABASE_SCHEMA!=='local_verified')throw Error('Synthetic live verification is restricted to the isolated local rehearsal');
const pool=createPool(),store=new Store(postgresDatabase(pool));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,env:process.env});let key,old;
try{
 const row=await store.one("SELECT payload FROM fixtures WHERE provider='openfootball' ORDER BY starts_at DESC LIMIT 1"),f=JSON.parse(row.payload);key=`live:state:${f.id}`;old=await store.one('SELECT * FROM football_cache WHERE id=?',key);
 const seed={revision:'synthetic-one',fixture:{id:f.id,provider:f.provider,status:'1H',label:'Live',homeScore:0,awayScore:0,elapsed:20},details:{fixture_events:[],fixture_statistics:[],lineups:[]},players:[],updatedAt:Date.now()};
 await store.putCache(key,seed,600000);
 const evidence={synthetic:true,origin,checks:[]};
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/football/match/'+routeToken(f.id),{waitUntil:'domcontentloaded'});
  await page.locator('.match-score strong').filter({hasText:'0 : 0'}).waitFor({timeout:60000});
  const prediction=await page.locator('.prediction-center').innerText();
  await store.putCache(key,{...seed,revision:`synthetic-goal-${width}`,fixture:{...seed.fixture,homeScore:1,elapsed:21},details:{...seed.details,fixture_events:[{minute:21,player:'Synthetic scorer',type:'Goal'}]},updatedAt:Date.now()},600000);
  await page.locator('.match-score strong').filter({hasText:'1 : 0'}).waitFor({timeout:20000});
  assert.equal(await page.locator('.prediction-center').innerText(),prediction,'Saved pre-match analysis must not change');
  assert.match(await page.locator('body').innerText(),/21′/);
  await page.getByText('Lineups and player statistics',{exact:true}).click();assert.match(await page.locator('body').innerText(),/Synthetic scorer/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  evidence.checks.push({width,sseScoreUpdate:true,incidents:true,predictionPreserved:true,errors});
  await page.close();await store.putCache(key,{...seed,revision:`synthetic-reset-${width}`,updatedAt:Date.now()},600000);
  await new Promise(resolve=>setTimeout(resolve,4100));
 }
 // Force EventSource absence: HTTP fallback still loads the persisted snapshot.
 const page=await browser.newPage();await page.addInitScript(()=>{Object.defineProperty(window,'EventSource',{value:undefined});});
 await page.goto(origin+'/football/match/'+routeToken(f.id),{waitUntil:'domcontentloaded'});await page.locator('.match-score strong').filter({hasText:'0 : 0'}).waitFor({timeout:60000});
 await store.putCache(key,{...seed,revision:'synthetic-fallback',fixture:{...seed.fixture,homeScore:2},updatedAt:Date.now()},600000);
 await page.locator('.match-score strong').filter({hasText:'2 : 0'}).waitFor({timeout:45000});evidence.httpFallback=true;
 writeFileSync('.sites-runtime/live-release/browser-live.json',JSON.stringify(evidence,null,2));console.log('PASS isolated database → SSE/browser changes, prediction preservation and HTTP fallback');
}finally{if(key){if(old)await store.upsert('football_cache',old);else await store.run('DELETE FROM football_cache WHERE id=?',key);}await browser.close();await pool.end();}
