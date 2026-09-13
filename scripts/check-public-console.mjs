import {localOrigin} from './local-origin.mjs';
// Local app journeys. Playwright handles navigation and isolated browser contexts.
// External providers are blocked; imports and real refresh checks run separately.
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
mkdirSync('outputs',{recursive:true});
const errors=[];try{const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&m.location().url.startsWith(origin))errors.push(m.text());});for(const path of ['/football','/football/players','/football/search?kind=player&q=Mbappe']){await p.goto(origin+path);await p.waitForTimeout(2500);}assert.deepEqual(errors,[]);console.log('PASS: no application console or runtime errors on homepage, Players and player search.');}finally{await browser.close();}
