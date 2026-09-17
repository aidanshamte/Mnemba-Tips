import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.argv[2];
const url = new URL(origin);
if (!(url.protocol==='https:' && url.hostname.endsWith('.azurecontainerapps.io')) && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Expected Azure-generated URL or loopback');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true,env:process.env});
const output = process.env.MNEMBA_BROWSER_OUTPUT ?? '.sites-runtime/azure-migration/browser';mkdirSync(output,{recursive:true});
const errors=[],evidence={origin,checks:[]};
const overviewResponse=await fetch(origin+'/api/intelligence?view=overview');assert.equal(overviewResponse.status,200);
const overview=await overviewResponse.json(),fixture=[...(overview.results??[]),...(overview.upcoming??[])][0],article=overview.news?.[0];
assert.ok(fixture&&article,'Persisted match and news required');
const {routeToken}=await import('../../lib/football/consumer.mjs');
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().startsWith(origin+'/api/')&&response.status()>=400)errors.push(response.status()+' '+new URL(response.url()).pathname);});
  // Exercise persisted data; external media failures must use the existing fallbacks.
  for(const path of ['/football','/football?tab=Fixtures','/football/search?kind=team&q=Arsenal','/football/search?kind=player&q=Messi','/football/predictions','/football/shortlists','/football/match/'+encodeURIComponent(fixture.id),'/football/news/'+routeToken(article.id)]) {
   const response=await page.goto(origin+path,{waitUntil:'networkidle',timeout:90000});assert.equal(response.status(),200);
   await page.locator('h1').first().waitFor();
   if(path==='/football') { await page.getByRole('status').filter({hasText:'covered matches'}).waitFor({timeout:60000}); await page.locator('.broadcast-action[href*="/match/"]').waitFor({timeout:60000}); }
   if(path.includes('/news/')) {await page.getByRole('heading',{name:'What happened',exact:true}).waitFor();await page.locator('.article-figure').scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const e=document.querySelector('.article-figure .news-visual');const img=e?.querySelector('img');return img?img.complete&&img.naturalWidth>0:!!e?.querySelector('.publisher-placeholder');});assert.equal(await page.locator('.article-figure img[src*="football-night"]').count(),0);}
   if(path.includes('/match/'))await page.locator('.match-score').waitFor();
   if(path.includes('search?'))await page.locator('a[role=option]').first().waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+path);
   const filename=`${width}-${evidence.checks.length}.png`;await page.screenshot({path:output+'/'+filename,fullPage:false});evidence.checks.push({width,path,screenshot:filename});
  }
  await page.goto(origin+'/football/search?kind=team&q=Arsenal',{waitUntil:'networkidle'});
  await page.locator('a[role=option]').first().click();await page.locator('h1').first().waitFor();assert.match(page.url(),/\/football\/team\//);
  await page.locator('.team-badge').first().waitFor();
  await page.waitForFunction(()=>{const e=document.querySelector('.team-badge');const img=e?.querySelector('img');return img?img.complete&&img.naturalWidth>0:e?.classList.contains('monogram-shield');});
  evidence.checks.push({width,teamVisual:await page.locator('.team-badge img').count()?'loaded badge':'labelled monogram'});
  await page.goto(origin+'/football/search?kind=player&q=Messi',{waitUntil:'networkidle'});
  await page.locator('a[role=option]').first().click();await page.getByRole('heading',{name:'Club association history'}).waitFor();
  const portrait = page.locator('.media-avatar').first();await portrait.waitFor();await portrait.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const e=document.querySelector('.media-avatar');const img=e?.querySelector('img');return img?img.complete&&img.naturalWidth>0:!!e?.querySelector('.avatar-initials');});
  evidence.checks.push({width,playerVisual:await portrait.locator('img').count()?'loaded portrait':'labelled fallback'});
  evidence.checks.push({width,path:new URL(page.url()).pathname,playerProfile:true});
  await page.goto(origin+'/basketball',{waitUntil:'networkidle'});
  await page.getByRole('tab',{name:'Basketball',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Basketball',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByText('Boston Celtics',{exact:true}).first().waitFor();
  assert.match(await page.getByRole('note').innerText(),/Demo data/);
  await page.locator('.match-tabs button').filter({hasText:'DEN'}).click();
  await page.getByText('Denver Nuggets',{exact:true}).first().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Basketball mobile overflow');
  await page.screenshot({path:output+'/'+width+'-basketball.png'});
  evidence.checks.push({width,path:'/basketball',demo:true});
  await page.goto(origin+'/lab',{waitUntil:'networkidle'});assert.ok(page.url().endsWith('/football'));
  await context.close();
 }
 for(const view of ['diagnostics','sources','performance'])assert.equal((await fetch(origin+'/api/intelligence?view='+view)).status,403);
 const blocked=await fetch(origin+'/api/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'source-policy',id:'api-football',enabled:true})});assert.ok([403,503].includes(blocked.status));
 assert.deepEqual(errors,[]);
 evidence.basketball='Existing model scenarios restored at /basketball; demo label, selection and responsive layout verified. No live basketball feed is claimed.';
 writeFileSync(output+'/evidence.json',JSON.stringify(evidence,null,2));console.log('PASS desktop/mobile football, fixtures, search, match, history, news, player profiles, basketball scenarios and legacy lab redirect');
} finally {await browser.close();}
