import {digest} from './http.mjs';
import {cleanText} from './news.mjs';
export function classifyAnnouncement(text){
 if(!text?.trim())return{kind:'inaccessible',confidence:0,verification:'unavailable'};
 const rules=[['lineup',/starting\s*(xi|11)|line[ -]?up|team sheet/i],['squad',/squad|called up|travelling party/i],['injury',/injur|hamstring|ligament|medical update/i],['suspension',/suspend|suspension|red card/i],['return-to-training',/return.*train|back.*train/i],['kickoff-change',/kick.?off.*(change|move)|reschedul|postpon/i],['match-poster',/matchday|match day|tonight.*vs/i]];
 const found=rules.find(([,pattern])=>pattern.test(text));return{kind:found?.[0]??'general',confidence:found?.[0]?0.65:0.4,verification:'candidate'};
}
export function safePostUrl(raw,platform){try{const u=new URL(raw);const hosts={youtube:['youtube.com','www.youtube.com','youtu.be'],instagram:['instagram.com','www.instagram.com'],facebook:['facebook.com','www.facebook.com'],x:['x.com','www.x.com','twitter.com','www.twitter.com']};if(u.protocol!=='https:'||u.username||u.password||!hosts[platform]?.includes(u.hostname))return null;return u.href;}catch{return null;}}
export class SocialService {
 constructor(store,http,evidence,env={}){this.store=store;this.http=http;this.evidence=evidence;this.env=env;}
 async registerFromWikidata(entityId,item){
  for(const [platform,claims] of Object.entries(item.social??{}))for(const claim of claims){
   const account=String(claim.value??'');if(!account||!/^[A-Za-z0-9_.@-]+$/.test(account))continue;
   const url=({youtube:`https://www.youtube.com/channel/${account}`,x:`https://x.com/${account}`,instagram:`https://www.instagram.com/${account}/`,facebook:`https://www.facebook.com/${account}`})[platform];
   // A Wikidata association is useful evidence, not automatic official-account verification.
   const id=await digest([platform,account]);await this.store.run('INSERT INTO social_accounts(id,entity_id,platform,account_id,url,name,verified,evidence_url,source_id,retrieved_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,account_id) DO UPDATE SET retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at',id,entityId,platform,account,url,item.name,0,item.sourceUrl,'wikidata',this.store.now(),this.store.now()+30*86400000);
   await this.evidence.queue('official-account',entityId,url,{accountId:id,wikidata:item.sourceUrl,required:'Corroborate against the official organization website before automated social ingestion.'});
  }
 }
 async youtube(){
  if(!this.env.YOUTUBE_API_KEY)return{status:'not-configured'};
  const accounts=await this.store.all("SELECT * FROM social_accounts WHERE platform='youtube' AND verified=1 AND expires_at>? LIMIT 15",this.store.now());let imported=0;
  for(const account of accounts){
   const headers={'X-Goog-Api-Key':this.env.YOUTUBE_API_KEY};
   const channels=await this.http.json('youtube',`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${encodeURIComponent(account.account_id)}`,{headers});
   const playlist=channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;if(!playlist)continue;
   const videos=await this.http.json('youtube',`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=12&playlistId=${encodeURIComponent(playlist)}`,{headers});
   for(const item of videos.items??[]){const videoId=item.snippet?.resourceId?.videoId,published=Date.parse(item.snippet?.publishedAt);if(!/^[\w-]{11}$/.test(videoId??'')||!Number.isFinite(published)||published>this.store.now())continue;
    const title=cleanText(item.snippet.title).slice(0,300),description=cleanText(item.snippet.description).slice(0,280),url=`https://www.youtube.com/watch?v=${videoId}`,classification=classifyAnnouncement(title+' '+description),id=`youtube:${videoId}`;
    await this.store.upsert('social_evidence',{id,account_id:account.id,source_id:'youtube',source_url:url,published_at:published,retrieved_at:this.store.now(),expires_at:this.store.now()+30*86400000,event_type:classification.kind,verification:'official-source; interpretation pending',confidence:classification.confidence,payload:JSON.stringify({title,description,videoId,summaryLabel:'Official channel metadata',classification})});
    if(classification.kind!=='general')await this.evidence.queue('announcement',account.entity_id,url,{socialId:id,classification,title,notice:'Keyword detection is not confirmation of any player status.'});imported++;
   }
  }
  return{status:'success',imported,verifiedAccounts:accounts.length};
 }
 async submitCandidate({entityId=null,url,platform,text='',uncertainNames=[]}){
  const safe=safePostUrl(url,platform);if(!safe)throw new Error('Invalid official-platform URL');
  const account=await this.store.one('SELECT * FROM social_accounts WHERE platform=? AND verified=1 AND ? LIKE url || \'%\'',platform,safe);
  const classification=classifyAnnouncement(text);
  return this.evidence.queue(uncertainNames.length?'image-derived-names':'announcement',entityId,safe,{text:cleanText(text).slice(0,500),textOrigin:text?'User-supplied evidence; not automatically extracted':'Inaccessible post; no extracted text',uncertainNames:uncertainNames.map(n=>String(n).slice(0,100)),accountVerified:!!account,classification});
 }
 async verify(id,decision,reference){
  if(!['verified','rejected'].includes(decision)||!/^https:\/\//.test(reference??''))throw new Error('A decision and verification reference are required');
  const row=await this.store.one("SELECT * FROM verification_queue WHERE id=? AND status='pending'",id);if(!row)throw new Error('Verification item unavailable');
  const payload=JSON.parse(row.payload);
  if(row.kind==='official-account'&&decision==='verified')await this.store.run('UPDATE social_accounts SET verified=1,evidence_url=?,expires_at=? WHERE id=?',reference,this.store.now()+30*86400000,payload.accountId);
  if(row.kind==='entity-match'&&decision==='verified')await this.evidence.reconcileAlias(payload.providerId,payload.canonicalId,reference);
  await this.store.run('UPDATE verification_queue SET status=?,resolved_at=?,resolution=? WHERE id=?',decision,this.store.now(),reference,id);
  return{status:decision};
 }
}
