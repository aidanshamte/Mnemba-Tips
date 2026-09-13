import {badgeCatalog} from './public-enrichment.mjs';
const rows=[
 ['epl','English Premier League','England','league','en.1',/english premier league|^premier league$/i],
 ['ucl','UEFA Champions League','Europe','continental-cup',null,/^uefa champions league/i],
 ['serie-a','Italian Serie A','Italy','league','it.1',/^(italian|italy) serie a$|^serie a$/i],
 ['j1','J1 League','Japan','league','jp.1',/j1 league|japan.*(?:j1|j league)|japanese j/i],
 ['super-lig','Turkish Süper Lig','Turkey','league','tr.1',/s[uü]per lig|turk.*super/i],
 ['brasileirao','Campeonato Brasileiro Série A','Brazil','league','br.1',/brazil.*s[eé]rie a|brasileir.*s[eé]rie a/i],
 ['csl','Chinese Super League','China','league','cn.1',/chin.*super league/i],
 ['championship','English Championship','England','league','en.2',/english.*championship/i],
 ['ligue-1','Ligue 1','France','league','fr.1',/^(french |france )?ligue 1$/i],
 ['uel','UEFA Europa League','Europe','continental-cup',null,/^uefa europa league/i],
 ['caf-cl','CAF Champions League','Africa','continental-cup',null,/^(caf|african) champions league/i],
 ['eredivisie','Eredivisie','Netherlands','league','nl.1',/eredivisie/i],
 ['portugal','Liga Portugal','Portugal','league','pt.1',/portug.*(?:liga|premier)|primeira liga|liga portugal/i],
 ['k1','K League 1','South Korea','league',null,/k.?league 1|korean.*league/i],
 ['laliga','LaLiga','Spain','league','es.1',/^(spain |spanish )?(primera divisi[oó]n|la ?liga)$/i],
 ['mls','Major League Soccer','United States','league','mls',/major league soccer/i],
 ['bundesliga','Bundesliga','Germany','league','de.1',/^(deutsche |german |1\. fußball-)?bundesliga$/i],
 ['uecl','UEFA Conference League','Europe','continental-cup',null,/^uefa (europa )?conference league/i],
 ['caf-cc','CAF Confederation Cup','Africa','continental-cup',null,/^caf confederation cup/i],
 ['libertadores','CONMEBOL Libertadores','South America','continental-cup','copa.l',/(?:copa |conmebol )?libertadores/i],
 ['liga-mx','Liga MX','Mexico','league',null,/liga mx|mexican primera/i],
 ['saudi','Saudi Pro League','Saudi Arabia','league',null,/saudi.*(?:professional|pro|premier).*league/i],
 ['sudamericana','CONMEBOL Sudamericana','South America','continental-cup',null,/sudamericana/i],
 ['u20-women','FIFA U-20 Women’s World Cup','International','national-tournament',null,/u.?20.*women.*world cup|women.*u.?20.*world cup/i]
];
export const PRIORITIES=rows.map(([id,name,country,category,fileCode,pattern])=>({id,name,country,category,fileCode,pattern,gender:id==='u20-women'?'women':'men',age:id==='u20-women'?'U20':'senior'}));
export function priorityFor(c){if(!c?.name)return null;return PRIORITIES.find(p=>p.pattern.test(c.name)&&(!( /women|female|u.?\d{2}|reserve/i.test(c.name))||p.id==='u20-women')&&(!c.country?.name||p.category!=='league'||c.country.name===p.country||(p.country==='United States'&&['USA','United States of America'].includes(c.country.name))))??null;}
export async function coverageMatrix(service){
 const s=service.store,fixtures=await service.deduplicateFixtures((await s.all('SELECT payload FROM fixtures')).map(r=>JSON.parse(r.payload))),badge=await badgeCatalog(s),details={};
 for(const table of ['lineups','football_appearances','fixture_events'])details[table]=new Set((await s.all(`SELECT DISTINCT fixture_id FROM ${table}`)).map(r=>r.fixture_id));
 const processing=new Map((await s.all('SELECT fixture_id,state FROM analysis_processing ORDER BY attempted_at')).map(r=>[r.fixture_id,r.state]));
 return{at:s.now(),competitions:PRIORITIES.map(p=>{const games=fixtures.filter(f=>priorityFor(f.competition)?.id===p.id),teams=new Map(games.flatMap(f=>[[f.home.id,f.home],[f.away.id,f.away]])),future=games.filter(f=>f.lifecycle?.state==='scheduled'),seasons=[...new Set(games.map(f=>f.seasonId))];return{...p,pattern:undefined,providerIds:[...new Set(games.map(f=>f.competition.id))],teams:teams.size,fixtures:games.length,seasons,latestRecordedDate:games.length?Math.max(...games.map(f=>f.startsAt)):null,stages:[...new Set(games.map(f=>f.round).filter(Boolean))],results:games.filter(f=>['FT','FINISHED','AET','PEN'].includes(f.status)).length,scheduled:future.length,verifiedUpcoming:future.filter(f=>f.kickoffPrecision!=='date'&&f.startsAt>s.now()).length,lineups:games.filter(f=>details.lineups.has(f.id)).length,playerMatches:games.filter(f=>details.football_appearances.has(f.id)).length,eventMatches:games.filter(f=>details.fixture_events.has(f.id)).length,badges:[...teams.keys()].filter(id=>badge.badges[id]).length,analysisAttempted:games.filter(f=>processing.has(f.id)).length,blockers:[...(!games.length?['No match records imported; competition listing is not coverage']:[]),...(!future.some(f=>f.startsAt>s.now())?['No future scheduled fixtures in imported records']:[]),'Current edition and full participant completeness require source verification; latest recorded season alone is not proof','Live, lineup and event coverage depends on configured permitted sources']};})};
}
export async function expandPriority(service){
 const s=service.store,year=new Date(s.now()).getUTCFullYear(),files=await s.all("SELECT * FROM source_files WHERE year>=? AND state IN ('pending','error') ORDER BY year DESC,path",year-2),selected=[];
 for(const p of PRIORITIES){const candidates=files.filter(f=>p.fileCode&&f.repository==='football.json'&&f.path.endsWith('/'+p.fileCode+'.json')||p.id==='saudi'&&/sa1|sa\.1/.test(f.path)||p.id==='ucl'&&f.repository==='champions-league'&&/\/clq?\.txt$/.test(f.path)||p.id==='uel'&&f.repository==='champions-league'&&/\/elq?\.txt$/.test(f.path)||p.id==='uecl'&&f.repository==='champions-league'&&/\/confq?\.txt$/.test(f.path)||p.id==='sudamericana'&&/copas\.txt$/.test(f.path));if(candidates[0])selected.push(candidates[0]);}
 const outcomes=[];for(const f of selected.slice(0,4)){try{const data=await service.open.load(f);if(!data.fixtures.length)throw Error('Unexpectedly empty source file');await service.saveFixtures(data.fixtures);await s.run("UPDATE source_files SET state='imported',last_import=?,fixture_count=?,error=NULL WHERE id=?",s.now(),data.fixtures.length,f.id);outcomes.push({file:f.path,state:'imported',fixtures:data.fixtures.length});}catch(e){await s.run("UPDATE source_files SET state='error',error=? WHERE id=?",e.message,f.id);outcomes.push({file:f.path,state:'failed',error:e.message});}}
 return{files:outcomes,remaining:selected.length>outcomes.length,scope:'Round-robin competition files, latest three source years; complete files, documented JSON mirrors preferred'};
}
