import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.argv[2]??'https://aidanshamte.me';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const output='.sites-runtime/ingestion-recovery';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true}),checks=[],errors=[];
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900},timezoneId:'UTC'});
  page.on('pageerror',error=>errors.push(error.message));
  if(new URL(origin).hostname==='127.0.0.1')await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());if(url.searchParams.has('stream')){await route.abort();return;}url.protocol='https:';url.host='aidanshamte.me';url.port='';
   try{const response=await route.fetch({url:url.href});await route.fulfill({response});}catch(error){if(!/already handled|Request context disposed|Target.*closed/.test(String(error)))throw error;}
  });
  for(const day of ['today','tomorrow','week']){
   const response=await page.goto(origin+'/football?tab=Fixtures&day='+day,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
   const status=page.getByRole('status').filter({hasText:/\d+ matches/});await status.waitFor({timeout:60000});
   const text=await status.innerText(),count=Number(text.match(/(\d+) matches/)[1]);
   assert.equal(await page.getByRole('region',{name:'More upcoming fixtures'}).count(),0);
   assert.equal(await page.locator('a.intel-match').count(),count);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   checks.push({width,day,count,additionalUpcoming:0});
   if(day==='today')await page.screenshot({path:`${output}/${new URL(origin).hostname}-${width}.png`});
  }
  await page.goto(origin+'/football?day=today',{waitUntil:'domcontentloaded'});
  await page.getByRole('status').filter({hasText:/\d+ matches/}).waitFor({timeout:60000});
  await page.locator('.broadcast-action[href*="/match/"]').waitFor({timeout:60000});
  await page.goto(origin+'/basketball',{waitUntil:'domcontentloaded'});
  await page.getByText('Boston Celtics',{exact:true}).first().waitFor({timeout:30000});
  assert.equal(await page.getByRole('tab',{name:'Basketball',exact:true}).getAttribute('aria-selected'),'true');
  checks.push({width,basketball:true});await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(`${output}/browser-${new URL(origin).hostname}.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}
