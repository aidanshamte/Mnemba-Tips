import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.argv[2],output=process.env.MNEMBA_BROWSER_OUTPUT??'.sites-runtime/global-coverage/browser';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,env:process.env}),evidence=[];
mkdirSync(output,{recursive:true});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/football/coverage',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Football coverage'}).waitFor();await page.locator('tbody tr').first().waitFor();
 assert.match(await page.locator('body').innerText(),/Egyptian Premier League/);
 await page.getByLabel('Coverage region').selectOption('Africa');
 assert.match(await page.locator('tbody').innerText(),/History only/);
 assert.ok(!(await page.locator('tbody').innerText()).includes('J1 League'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${output}/${width}-coverage.png`});
 await page.goto(origin+'/football?tab=Fixtures',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Competition',exact:true}).click();
 await page.getByLabel('Region',{exact:true}).selectOption('Africa');await page.getByLabel('Country',{exact:true}).selectOption('Egypt');
 await page.locator('.competition-options button').filter({hasText:'Egyptian Premier League'}).click();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('competition'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${output}/${width}-egypt.png`});
 assert.deepEqual(errors,[]);evidence.push({width,coverage:true,regionCountrySelection:true,errors});await page.close();
}}finally{writeFileSync(output+'/evidence.json',JSON.stringify(evidence,null,2));await browser.close();}
console.log('PASS global coverage and region/country discovery at desktop/mobile widths');
