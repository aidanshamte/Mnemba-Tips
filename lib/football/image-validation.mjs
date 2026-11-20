import sharp from 'sharp';
import {createHash} from 'node:crypto';
const hostBackoff=new Map();
// Used by offline enrichment only, never by the edge application.
export async function validateLogoBytes(bytes,contentType){
 if(!/^image\/(png|jpeg|webp|avif|svg\+xml)(?:;|$)/i.test(contentType??''))throw Error('Response is not an accepted image');
 if(bytes.length>5*1024*1024||bytes.length<80)throw Error('Image byte size outside allowed bounds');
 if(/svg/i.test(contentType)&&/<!DOCTYPE|<!ENTITY|<script|<foreignObject|(?:href|src)\s*=\s*["'](?!#)|@import|url\(\s*["']?(?!#)[a-zA-Z./]/i.test(bytes.toString()))throw Error('SVG contains external or active content');
 const decoded=sharp(bytes,{limitInputPixels:16000000,failOn:'error'}),metadata=await decoded.metadata();
 if(!metadata.width||!metadata.height||Math.min(metadata.width,metadata.height)<32||Math.max(metadata.width,metadata.height)>4096||metadata.pages>1)throw Error('Image dimensions/animation rejected');
 const pixels=await decoded.ensureAlpha().raw().toBuffer();
 let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>20)visible++;
 if(visible<100)throw Error('Empty image');
 const stats=await sharp(pixels,{raw:{width:metadata.width,height:metadata.height,channels:4}}).stats();
 if(stats.channels.every(c=>c.stdev<1))throw Error('Uniform image');
 return {width:metadata.width,height:metadata.height,contentType,contentHash:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
export async function downloadLogo(url,fetcher=fetch){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('HTTPS image required');
 if(/(?:^|\/)(?:no[-_]?image|no[-_]?logo|placeholder|default[-_](?:badge|logo))\.(?:png|svg|jpe?g|webp)$/i.test(u.pathname))throw Error('Known placeholder image rejected');
 if((hostBackoff.get(u.hostname)??0)>Date.now())throw Error('Image host backoff active: '+u.hostname);
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===429||response.status===503){const retry=response.headers.get('retry-after');const delay=Math.max(60000,Number(retry)*1000||Date.parse(retry)-Date.now()||0);hostBackoff.set(u.hostname,Date.now()+delay);}
 if(!response.ok)throw Error('HTTP '+response.status);
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>5*1024*1024)throw Error('Image exceeds size limit');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=Buffer.concat(chunks);return {bytes,metadata:await validateLogoBytes(bytes,response.headers.get('content-type'))};
}
