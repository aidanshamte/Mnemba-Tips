import {sourceById,sourceForUrl,permissionState} from './source-registry.mjs';
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export class SourceHttp {
 constructor(store,env={},options={}){this.store=store;this.env=env;const fetcher=options.fetcher??fetch;this.fetcher=(...args)=>fetcher(...args);this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));}
 async fetch(url,options={}){const source=sourceForUrl(url);if(!source)throw new Error('Source is not in the approved registry');return this.request(source.id,url,options);}
 async request(id,raw,options={}){
  const s=this.store,source=sourceById(id),url=new URL(raw),state=source&&permissionState(source,this.env);
  if(!source||!state.enabled)throw new Error(state?.reason??'Unknown source');
  if(!source.hosts.includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Source host mismatch');
  const registry=await s.one('SELECT * FROM source_registry WHERE id=?',id);if(registry?.user_enabled===0)throw new Error('Source disabled by administrator');
  const key=await digest(`${id}:${url.href}`),cache=await s.one('SELECT * FROM http_response_cache WHERE id=?',key);
  const ttl=id==='api-football'&&(url.searchParams.has('id')||url.searchParams.has('fixture'))?300000:source.refreshMs;
  if(cache&&cache.expires_at>s.now())return new Response(cache.body,{headers:{'content-type':cache.content_type??'application/json','x-pitchpredict-cache':'hit','x-retrieved-at':String(cache.retrieved_at)}});
  if(registry?.next_allowed_at>s.now()){const wait=registry.next_allowed_at-s.now();if(wait>15000)throw new Error('Source backoff active; cached data preserved');await this.sleep(wait);}
  const headers=new Headers(options.headers);headers.set('User-Agent','Mnemba TipsLocal/4.0 (personal football research; cached requests)');
  if(cache?.etag)headers.set('If-None-Match',cache.etag);if(cache?.modified)headers.set('If-Modified-Since',cache.modified);
  for(let attempt=0;attempt<3;attempt++){
   const day=s.day();const reserved=await s.one('INSERT INTO source_request_usage(source_id,day,used) VALUES(?,?,1) ON CONFLICT(source_id,day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used',id,day,source.dailyLimit);
   if(!reserved)throw new Error(`${source.name} local free-request budget exhausted`);
   await s.run('UPDATE source_registry SET last_attempt=?,next_allowed_at=? WHERE id=?',s.now(),s.now()+source.minGapMs,id);
   let response;
   try{response=await this.fetcher(url,{...options,headers,redirect:'manual',signal:options.signal??AbortSignal.timeout(20000)});}catch(error){await s.run('UPDATE source_registry SET last_error=? WHERE id=?','Network unavailable',id);if(attempt===2||id==='api-football')throw new Error(`${source.name}: network unavailable`);await this.sleep(1000*2**attempt);continue;}
   if(url.hostname==='api.github.com'&&response.headers.get('x-ratelimit-remaining')==='0'){const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;await s.run('UPDATE source_registry SET next_allowed_at=? WHERE id=?',Math.max(s.now()+60000,reset||s.now()+3600000),id);}
   // The primary provider's own adapter handles retries and its 100-attempt budget.
   if((response.status===429||response.status>=500)&&id!=='api-football'){
    const retry=response.headers.get('retry-after'),delay=Math.max(1000*2**attempt,retry?(Number(retry)*1000||Date.parse(retry)-s.now()):0);
    await s.run('UPDATE source_registry SET next_allowed_at=?,last_error=? WHERE id=?',s.now()+Math.max(delay,source.minGapMs),`HTTP ${response.status}; backing off`,id);
    if(delay>15000||attempt===2)throw new Error(`${source.name}: HTTP ${response.status}, retry deferred`);await this.sleep(delay);continue;
   }
   if(response.status===304&&cache){await s.run('UPDATE http_response_cache SET expires_at=?,retain_until=? WHERE id=?',s.now()+ttl,s.now()+source.retentionMs,key);await s.run('UPDATE source_registry SET last_success=?,last_error=NULL WHERE id=?',s.now(),id);return new Response(cache.body,{headers:{'content-type':cache.content_type??'application/json','x-pitchpredict-cache':'revalidated','x-retrieved-at':String(cache.retrieved_at)}});}
   if(!response.ok){await s.run('UPDATE source_registry SET last_error=? WHERE id=?',`HTTP ${response.status}`,id);return response;}
   const body=await response.text();
   if(body.length<1500000)await s.upsert('http_response_cache',{id:key,source_id:id,url:url.href,etag:response.headers.get('etag'),modified:response.headers.get('last-modified'),body,content_type:response.headers.get('content-type'),retrieved_at:s.now(),expires_at:s.now()+ttl,retain_until:s.now()+source.retentionMs});
   await s.run('UPDATE source_registry SET last_success=?,last_error=NULL WHERE id=?',s.now(),id);
   const resultHeaders=new Headers(response.headers);resultHeaders.set('x-retrieved-at',String(s.now()));resultHeaders.delete('content-encoding');resultHeaders.delete('content-length');
   return new Response(body,{status:response.status,headers:resultHeaders});
  }
 }
 async json(id,url,options={}){const response=await this.request(id,url,options);if(!response.ok)throw new Error(`${id}: HTTP ${response.status}`);return response.json();}
}
