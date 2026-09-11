// Local-only browser smoke check. Provider requests and synchronization are blocked.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:8787';
const browser=process.env.PITCHPREDICT_TEST_BROWSER??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port=9327;
mkdirSync('outputs',{recursive:true});
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('.sites-runtime','browser-smoke')}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
try {
 let target;
 for(let i=0;i<60;i++){try{const response=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'});target=await response.json();break;}catch{await sleep(250);}}
 if(!target)throw new Error('Headless browser failed to start');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();const errors=[];
 const command=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}));});
 socket.addEventListener('message',async event=>{
   const message=JSON.parse(event.data);
   if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(new Error(message.error.message)):p?.resolve(message.result);}
   if(message.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(message.params.exceptionDetails));
   if(message.method==='Fetch.requestPaused'){
     try {
     const {requestId,request}=message.params;
     if(!request.url.startsWith(origin)&&!request.url.startsWith('data:')&&request.url!=='about:blank')await command('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
     else if(request.method==='POST'&&/\/api\/(football|intelligence)/.test(request.url))await command('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{"status":"idle"}').toString('base64')});
     else await command('Fetch.continueRequest',{requestId});
     } catch(error) { if(!/Invalid InterceptionId|Invalid requestId|Target closed/i.test(error.message))errors.push(error.message); }
   }
 });
 await command('Page.enable');await command('Runtime.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>(await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 const visit=async path=>{await command('Page.navigate',{url:origin+path});for(let i=0;i<100;i++){await sleep(100);if(await evaluate("document.readyState==='complete' && !!document.querySelector('h1')"))break;}await sleep(1200);};
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await visit('/football');assert.match(await evaluate('document.body.innerText'),/Analyze Match/);assert.equal(await evaluate('document.querySelectorAll("select[aria-label=Country],select[aria-label=Competition]").length'),2);
 let screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('outputs/football-desktop.png',Buffer.from(screenshot.data,'base64'));
 for(const view of ['catalog','news','diagnostics','live','upcoming','recent','search']){await visit(`/football/classic?view=${view}`);assert.ok(!(await evaluate('document.body.innerText')).includes('Internal Server Error'));}
 for(const tab of ['Fixtures','Competitions','News','Social','Diagnostics']){await visit('/football');await evaluate(`Array.from(document.querySelectorAll('.intel-sidebar nav button')).find(b=>b.textContent.trim()===${JSON.stringify(tab)}).click()`);await sleep(1200);assert.ok(!(await evaluate('document.body.innerText')).includes('Internal Server Error'));}
 const cached=await (await fetch(`${origin}/api/football?view=fixtures`)).json();
 if(cached.fixtures?.length){await visit(`/football/match/${encodeURIComponent(cached.fixtures[0].id)}`);assert.match(await evaluate('document.body.innerText'),/Prediction center/);assert.match(await evaluate('document.body.innerText'),/Head-to-head timeline/);}
 if(cached.fixtures?.length){await visit('/football/team/'+encodeURIComponent(cached.fixtures[0].home.id));assert.match(await evaluate('document.body.innerText'),/ENTITY PROFILE/);}
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await visit('/football');assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
 screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('outputs/football-mobile.png',Buffer.from(screenshot.data,'base64'));

 await visit('/football');const article=await evaluate("document.querySelector('.intel-news a')?.getAttribute('href')");assert.ok(article?.startsWith('/football/news/'));await visit(article);assert.match(await evaluate('document.body.innerText'),/Publisher feed description/);
 const regression='openfootball:16c2fe8e6275b62fada77d4beef8f5b918e5a96e3939a183fe9792dee7b91a3a';
 await visit('/football/search?q=FC%20Augsburg');assert.match(await evaluate('document.body.innerText'),/FC Augsburg/);
 const teamLink=await evaluate("Array.from(document.querySelectorAll('a')).find(a=>a.href.includes('/football/team/'))?.getAttribute('href')");assert.ok(teamLink);assert.ok(!teamLink.includes('%2520'));await visit(teamLink);assert.match(await evaluate('document.body.innerText'),/FC Augsburg/);
 for(const [width,height,label] of [[1440,1000,'desktop'],[768,1024,'tablet'],[390,844,'mobile']]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await visit('/football/match/'+encodeURIComponent(regression));assert.match(await evaluate('document.body.innerText'),/Head-to-head timeline/);assert.match(await evaluate('document.body.innerText'),/Standings comparison/);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('outputs/match-'+label+'.png',Buffer.from(shot.data,'base64'));}
 for(const path of ['/football/admin','/football/predictions','/football/match/statsbomb%3A4020846']){await visit(path);assert.ok(!(await evaluate('document.body.innerText')).includes('Internal Server Error'));assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));}
 await visit('/lab');await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Basketball')).click()");await sleep(500);assert.match(await evaluate('document.body.innerText'),/Projected starting five/);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Browser smoke passed: desktop, mobile overflow, all football views, basketball interaction; no provider calls.');
 await command('Browser.close');
}finally{socket?.close();child.kill();}
