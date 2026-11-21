import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.argv[2],output=process.env.MNEMBA_BROWSER_OUTPUT??'.sites-runtime/useful-product/browser';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const {routeToken}=await import('../../lib/football/consumer.mjs');
const get=async params=>{const r=await fetch(origin+'/api/intelligence?'+new URLSearchParams(params));assert.equal(r.status,200);return r.json()};
const history=await get({view:'prediction-history',tab:'exploratory'}),overview=await get({view:'overview'});
const acceptance='openfootball:ba6548ad15783f05412f10dcd8f0dc39649e31e6dce831a88fd806ff10f19b22';
const ids=[...new Set([acceptance,...history.matches.slice(0,2).map(m=>m.fixture.id),overview.results[0]?.id].filter(Boolean))];
const browser=await chromium.launch({headless:true,env:process.env}),evidence={origin,matches:[],images:[],errors:[]};mkdirSync(output,{recursive:true});
try{for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>evidence.errors.push(e.message));
 for(const id of ids){const data=await get({view:'match-context',id});assert.ok(data.fixture);const response=await page.goto(origin+'/football/match/'+encodeURIComponent(id),{waitUntil:'networkidle'});assert.equal(response.status(),200);await page.locator('.prediction-center').waitFor();
 if(data.analysis.archive?.exploratory.length||data.analysis.archive?.selected){assert.ok(data.analysis.probabilities,'Saved predictions remain visible');await page.locator('.prediction-pick').first().waitFor();assert.ok(data.analysis.asOf);}
 if(data.analysis.needsRefresh)await page.getByText('Needs refresh · showing the saved prediction',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Match overflow');
 await page.waitForLoadState('networkidle');const images=await page.locator('.match-score .team-badge').evaluateAll(nodes=>nodes.map(e=>{const img=e.querySelector('img');return{name:e.textContent||img?.alt,loaded:!!img&&img.complete&&img.naturalWidth>0,fallback:e.classList.contains('team-name-fallback')}}));
 evidence.matches.push({width,id,probabilities:data.analysis.probabilities,asOf:data.analysis.asOf,needsRefresh:!!data.analysis.needsRefresh,images});await page.screenshot({path:output+'/'+width+'-'+evidence.matches.length+'.png'});
 }
 // Image coverage requires a real decoded image; fallback layout is a separate outcome.
 const badges=await get({view:'badges'});for(const [id,asset] of Object.entries(badges.badges).slice(0,3)){
 await page.goto(origin+'/football/team/'+routeToken(id),{waitUntil:'networkidle'});const result=await page.locator('.team-badge').first().evaluate(async e=>{const img=e.querySelector('img');if(!img)return{loaded:false,fallback:true};try{await img.decode();return{loaded:img.naturalWidth>0,url:img.currentSrc}}catch{return{loaded:false,url:img.currentSrc}}});evidence.images.push({width,id,...result});
 }
 await page.close();}
 assert.ok(evidence.images.some(i=>i.loaded),'At least one real badge must load; fallbacks do not pass image verification');assert.deepEqual(evidence.errors,[]);
}finally{writeFileSync(output+'/evidence.json',JSON.stringify(evidence,null,2));await browser.close()}
console.log(JSON.stringify({matches:evidence.matches.length,loadedImages:evidence.images.filter(i=>i.loaded).length,failedImages:evidence.images.filter(i=>!i.loaded).length,errors:evidence.errors.length}));
