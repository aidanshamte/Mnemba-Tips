import {localOrigin} from './local-origin.mjs';
// Local app journeys. Playwright handles navigation and isolated browser contexts.
// External providers are blocked; imports and real refresh checks run separately.
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
mkdirSync('outputs',{recursive:true});
try{const page=await browser.newPage({viewport:{width:1280,height:900}});const data=await(await fetch(origin+'/api/intelligence?view=news')).json();const story=data.articles.find(n=>n.media?.permission==='publisher-embed');const {routeToken}=await import('../lib/football/consumer.mjs');await page.goto(origin+'/football/news/'+routeToken(story.id));await page.getByRole('button',{name:'Play publisher video'}).click();const frame=page.frameLocator('iframe');await frame.locator('button').first().waitFor({state:'attached',timeout:30000});console.log(await frame.locator('button').evaluateAll(bs=>bs.map(b=>({label:b.getAttribute('aria-label'),title:b.title,class:b.className}))));await frame.getByRole('button',{name:/play/i}).first().click({timeout:15000});await page.waitForTimeout(6000);const playback=await frame.locator('video').evaluate(v=>({currentTime:v.currentTime,paused:v.paused,readyState:v.readyState}));const playerText=await frame.locator('body').innerText();console.log(JSON.stringify({url:story.id,playback,status:playback.currentTime>0?'playing':/not a bot|Sign in/i.test(playerText)?'externally-blocked-sign-in':'not-playing',playerText}));await page.screenshot({path:'outputs/page-upgrade/video-playing.png'});}finally{await browser.close();}
