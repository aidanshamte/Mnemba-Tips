export const IMAGE_HOSTS=['ichef.bbci.co.uk','i.guim.co.uk','media.guim.co.uk','editorial.uefa.com','img.uefa.com','upload.wikimedia.org','thumb.wikimedia.org','www.thesportsdb.com','r2.thesportsdb.com','i.ytimg.com'];
// Logo-only extension: decoded, hashed artwork; publisher image policy is unchanged.
export function safeLogoImage(raw,metadata={}){if(safeImage(raw))return raw;try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&(['upload.wikimedia.org','assets.dfb.de','storage.livescore.com','upl.co.ug','cdnbfc.com','dsg-images.com','www.dsg-images.com','www.bundesliga-reisefuehrer.de','www.openligadb.de'].includes(u.hostname)||(u.hostname==='raw.githubusercontent.com'&&/^\/luukhopman\/football-logos\/[a-f0-9]{40}\//.test(u.pathname)))&&/\.(svg|png|jpe?g|webp)$/i.test(u.pathname)&&/^[a-f0-9]{64}$/.test(metadata.contentHash??'')&&metadata.width>=32&&metadata.height>=32?u.href:null;}catch{return null;}}
export function safeImage(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||!IMAGE_HOSTS.includes(u.hostname)||/\.(svg|gif|html?|js)$/i.test(u.pathname)||/[<>]|%3c|%3e/i.test(u.href)||[...u.searchParams.keys()].some(k=>/^(utm_|fbclid|gclid|tracking)/i.test(k)))return null;return u.href;}catch{return null;}}
// Preserve publisher URLs (including signed query strings) except BBC's size path.
export function newsImageCandidates(images=[]){
 const ranked=images.map((m,index)=>({...m,index})).sort((a,b)=>
  (Number(b.width)||0)*(Number(b.height)||0)-(Number(a.width)||0)*(Number(a.height)||0)||
  (a.kind==='rss'?0:1)-(b.kind==='rss'?0:1)||a.index-b.index);
 return ranked.flatMap(({index,...m})=>{
  const url=safeImage(m.url);if(!url)return [];
  const u=new URL(url),match=u.pathname.match(/^\/(news|ace)\/standard\/(\d+)\//);
  if(u.hostname==='ichef.bbci.co.uk'&&match&&Number(match[2])<1920){
   u.pathname=u.pathname.replace(/\/standard\/\d+\//,'/standard/1920/');
   return [{...m,url:u.href},{...m,url}];
  }
  return [{...m,url}];
 });
}
export function newsMedia(a,excluded=[]){
 const images=(a?.images??[]).filter(m=>['rss','opengraph'].includes(m.kind)&&m.articleUrl===a.url&&m.usageBasis&&m.attribution);
 const m=newsImageCandidates(images).find(m=>!excluded.includes(m.url));if(m)return{...m,type:'image'};
 if(a?.media?.permission==='publisher-embed'&&a.media.articleUrl===a.url&&safeImage(a.media.thumbnail)&&!excluded.includes(a.media.thumbnail))return{type:'video',url:a.media.thumbnail,attribution:a.publisher};
 if(a?.entityImage?.entityId&&a.entityImage.verifiedAt&&a.entityImage.usageBasis&&safeImage(a.entityImage.url)&&!excluded.includes(a.entityImage.url))return{...a.entityImage,type:'image'};
 return{type:'placeholder',publisher:a?.publisher??'Mnemba Tips'};
}
export function mediaIdentity(entity,record){return entity.id===record.entityId&&entity.type===record.entityType&&(!record.country||!!entity.country&&entity.country===record.country)&&(!record.canonicalId||entity.canonicalId===record.canonicalId);}
export function validMediaRecord(r){return !!(safeImage(r.url)&&r.entityId&&['team','player','competition','publisher'].includes(r.entityType)&&r.sourceUrl?.startsWith('https://')&&r.usageBasis&&r.attribution&&r.verifiedAt&&r.lastSuccess&&r.width>0&&r.height>0);}
