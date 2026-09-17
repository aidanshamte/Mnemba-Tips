import {assertLocalOrigin,runtimeMode} from './runtime-mode.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
let driver;try{driver=await import('playwright');}catch{const entry=(process.env.PATH??'').split(delimiter).map(p=>resolve(p,'../playwright/index.mjs')).find(existsSync);if(!entry)throw Error('Run with the pinned Playwright package');driver=await import(pathToFileURL(entry).href);}
const origin=process.env.MNEMBA_ORIGIN??'http://localhost:5173';
if(runtimeMode()==='local')assertLocalOrigin(origin);
const libraries=resolve('.sites-runtime/browser-libs/root/usr/lib/x86_64-linux-gnu');
const browser=await driver.chromium.launch({headless:true,env:{...process.env,LD_LIBRARY_PATH:libraries}});
mkdirSync('outputs/history',{recursive:true});
try{
 for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'America/New_York'}),page=await context.newPage();
  await page.goto(origin+'/football/predictions');await page.getByRole('heading',{name:'Your matchday record'}).waitFor();
  const picker=page.getByRole('combobox',{name:'Timezone'});await page.waitForFunction(()=>document.querySelector('select[aria-label="Timezone"] option[value="local"]')?.textContent.includes('America/New_York'));
  assert.equal(await picker.locator('option').count(),5);assert.equal(await page.locator('body').textContent().then(t=>t.includes('Pacific/Auckland')),false);
  await page.getByRole('button',{name:'More timezones',exact:true}).click();await page.getByRole('textbox',{name:'Search timezones'}).fill('Auckland').catch(async e=>{console.log(label,await page.locator('dialog').evaluateAll(nodes=>nodes.map(n=>n.outerHTML.slice(0,500))));await page.screenshot({path:'outputs/history/failure.png'});throw e;});await page.getByRole('button',{name:'Pacific/Auckland',exact:true}).click();assert.equal(await picker.inputValue(),'Pacific/Auckland');
  await page.reload();await page.waitForFunction(()=>document.querySelector('select[aria-label="Timezone"]')?.value==='Pacific/Auckland');
  await picker.selectOption('local');await Promise.all([page.waitForResponse(r=>r.url().includes('view=prediction-history')&&r.url().includes('tab=exploratory')),page.getByRole('button',{name:'Exploratory previews',exact:true}).click()]);
  await page.getByRole('status').waitFor({state:'hidden',timeout:60000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`outputs/history/${label}.png`,fullPage:true});await context.close();
 }
 console.log('History desktop/mobile layout, compact selector, search and persistence passed.');
}finally{await browser.close();}
