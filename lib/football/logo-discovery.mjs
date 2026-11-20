export function logoName(value){return String(value??'').replace(/\s+\[(?:postponed|cancelled|abandoned)\]\s*$/i,'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ß','ss').replace(/\b(fc|sc|cf|afc)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function tableLogoCandidates(html){const result=new Map();for(const table of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)??[]){for(const tag of table.match(/<img\b[^>]*>/gi)??[]){const attrs=Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(m=>[m[1].toLowerCase(),m[2]]));if(!/^https:\/\/cdnbfc\.com\//.test(attrs.src??'')||!/(?:team )?logo$/i.test(attrs.alt??''))continue;const name=attrs.alt.replace(/\s+(?:team )?logo$/i,'').trim(),key=name+'|'+attrs.src;result.set(key,{name,url:attrs.src});}}return [...result.values()];}
export function uniqueLogoMatch(name,candidates){const matches=candidates.filter(c=>logoName(c.name)===logoName(name));return matches.length===1?matches[0]:null;}
// Read-only geography from the already recorded, explicit OpenFootball source file.
// Older fixtures predate geography enrichment; do not rewrite their payloads.
export function visualCompetitionContext(competition,sourceUrl){if(competition?.country?.name)return competition;try{const u=new URL(sourceUrl);if(u.hostname!=='raw.githubusercontent.com'||!u.pathname.startsWith('/openfootball/football.json/'))return competition;const code=u.pathname.match(/\/([a-z]{2})\.\d+\.json$/)?.[1];const g={en:['England','Europe'],de:['Germany','Europe'],es:['Spain','Europe'],it:['Italy','Europe'],fr:['France','Europe'],tr:['Turkey','Europe'],nl:['Netherlands','Europe'],pt:['Portugal','Europe'],cn:['China','Asia'],br:['Brazil','South America'],ar:['Argentina','South America']}[code];return g?{...competition,country:{name:g[0],continent:g[1],sourceUrl}}:competition;}catch{return competition;}}
export function profileCountry(html){const info=html.match(/Team Info<\/h2>([\s\S]{0,5000}?)<h2[^>]*>Competition/i)?.[1];if(!info)return null;const values=info.match(/<div\b[^>]*class="[^"]*has-text-right[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];return [...(values??'').matchAll(/<p\b[^>]*>([^<]*)<\/p>/gi)].map(m=>m[1].trim())[1]??null;}

// Asset base observed on the provider's public football page. Never derive an
// image filename from a team ID: it must be supplied by that team's record.
export function liveScoreLogoCandidate(team,eventId){
 if(!/^\d+$/.test(String(team?.ID))||!/^\d+$/.test(String(eventId))||!team.Nm||team.Spid!=null&&Number(team.Spid)!==1||! /^(?:enet\/\d+|teambadge\/[a-zA-Z0-9_-]+)\.(?:png|jpg)$/.test(team.Img??''))return null;
 return {url:'https://storage.livescore.com/images/team/high/'+team.Img,alternateUrls:['https://storage.livescore.com/images/team/medium/'+team.Img],sourceUrl:'https://prod-cdn-public-api.lsmedia1.com/v1/api/app/scoreboard/soccer/'+eventId,sourceEntityId:'livescore:'+team.ID,entityName:team.Nm,country:team.CoNm??null,gender:team.Gd??null,basis:'Exact team ID/name and image reference in the same authorized provider scoreboard',attribution:'LiveScore team image reference; mark belongs to its owner'};
}

export function liveScoreCompetitionLogoCandidate(stage,eventId){
 if(!/^\d+$/.test(String(stage?.Sid))||!/^\d+$/.test(String(eventId))||!stage.Snm||!/^[-a-zA-Z0-9_]+\.(?:png|jpg)$/.test(stage.badgeUrl??''))return null;
 return {url:'https://storage.livescore.com/images/competition/high/'+stage.badgeUrl,sourceUrl:'https://prod-cdn-public-api.lsmedia1.com/v1/api/app/scoreboard/soccer/'+eventId,sourceEntityId:'livescore:'+stage.Sid,entityName:stage.Snm,country:stage.Cnm??null,basis:'Exact competition stage ID/name and badgeUrl in the same authorized provider response',attribution:'LiveScore competition image reference; mark belongs to its owner'};
}

export function verifiedLogoMatch(target,candidates){
 const matches=candidates.filter(c=>logoName(c.name)===logoName(target.name)&&c.category===target.category&&c.countries.some(country=>target.countries.includes(country)));
 return matches.length&&new Set(matches.map(c=>c.media.contentHash)).size===1?matches[0]:null;
}
