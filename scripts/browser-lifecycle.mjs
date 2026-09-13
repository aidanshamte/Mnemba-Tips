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

mkdirSync('outputs/lifecycle',{recursive:true});
const id='openfootball:622eecd7741a73a6efea0eba054f065a70ea52e79e776b10487c9e19ab010a60';
const real=await(await fetch(origin+'/api/intelligence?view=match-context&id='+encodeURIComponent(id))).json();
assert.equal(real.fixture.lifecycle.state,'scheduled');assert.ok(real.analysis.probabilities);
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/football/match/'+encodeURIComponent(id));await page.getByRole('heading',{name:/Prediction center/}).waitFor();await page.getByText('Kickoff time to be confirmed.',{exact:false}).first().waitFor();await page.screenshot({path:'outputs/lifecycle/real-liverpool-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/lifecycle/real-liverpool-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.goto(origin+'/football/predictions');await page.getByRole('heading',{name:'Prediction history',exact:true}).first().waitFor();await page.screenshot({path:'outputs/lifecycle/history-mobile.png'});
 const fixture=structuredClone(real);fixture.fixture.home.name='TEST ONLY · Home';fixture.fixture.away.name='TEST ONLY · Away';fixture.fixture.kickoffPrecision='instant';fixture.fixture.startsAt=Date.parse('2026-09-12T18:00:00Z');fixture.analysis.trackingNote='Deterministic browser test only. No database records written.';
 const version={id:'test-original',modelVersion:'poisson-temporal-1',createdAt:Date.parse('2026-09-12T17:00:00Z'),gradeState:'pending',payload:{probabilities:[.5,.3,.2]}};
 fixture.analysis.probabilities=[.5,.3,.2];fixture.analysis.archive={original:version,selected:version,versions:[version],exploratory:[]};
 await page.route('**/api/intelligence?view=match-context*',route=>route.fulfill({json:fixture}));
 for(const [status,label] of [['NS','Scheduled'],['1H','In progress'],['FT','Completed']]){
  fixture.fixture.status=status;fixture.fixture.label=label;fixture.fixture.homeScore=status==='NS'?null:2;fixture.fixture.awayScore=status==='NS'?null:1;
  if(status==='FT'){version.gradeState='graded';version.gradeReason='Verified regulation-time result';version.grade={homeScore:2,awayScore:1,resultCorrect:true,exactScoreCorrect:false};}
  await page.goto(origin+'/football/match/test-only');await page.getByRole('heading',{name:/Prediction center/}).waitFor();await page.getByText('Home 50.0% · Draw 30.0% · Away 20.0%',{exact:true}).waitFor();if(status==='FT')await page.getByText('Exact score: incorrect',{exact:false}).waitFor();await page.screenshot({path:'outputs/lifecycle/test-'+status+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({realScheduledMatch:id,realProbabilityAvailable:true,simulatedLifecycle:['scheduled','live','completed'],retainedForecast:'test-original',databaseTestWrites:0,pageErrors:errors}));
}finally{await browser.close();}
