const origin='http://127.0.0.1:8787';
async function post(body,path='/api/intelligence'){const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(540000)});const result=await r.json();console.log(JSON.stringify({job:body.job,status:r.status,result}));return result;}
const {files}=await(await fetch(origin+'/api/intelligence?view=files')).json();
for(const pattern of [/^african_cup_of_nations\/2026/,/^2026-27\/en\.1\.json$/,/saudi-arabia/]){const file=files.find(f=>pattern.test(f.path));if(file)await post({job:'history',fileId:file.id});}
for(const job of ['reconcile','entities','identities','archive','backfill','news','snapshots','calibration'])try{await post({job});}catch(e){console.log(JSON.stringify({job,error:e.message}));}
await post({job:'historical'},'/api/football');
