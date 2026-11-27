import {decideRecommendation} from './recommendations.mjs';
import {matchState,analysisCutoff,withMatchState} from './match-state.mjs';
import {savedEstimate} from './estimates.mjs';
import {lineupContext} from './probable-lineup.mjs';
import {historyFor,form,headToHead} from './model.mjs';

// Opaque Unicode-safe route tokens avoid encoding already encoded provider IDs.
export const routeToken=id=>'id-'+Array.from(new TextEncoder().encode(id),b=>b.toString(16).padStart(2,'0')).join('');
export function providerId(token){if(!/^id-(?:[0-9a-f]{2})+$/i.test(token??''))return typeof token==='string'&&!token.includes(':')&&/%3a/i.test(token)?decodeURIComponent(token):token;return new TextDecoder().decode(Uint8Array.from(token.slice(3).match(/../g),h=>parseInt(h,16)));}
export function deriveTable(fixtures,cutoff,venue=null){
 const rows=new Map();
 for(const f of fixtures){for(const t of [f.home,f.away])if(!rows.has(t.id))rows.set(t.id,{team:t,played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,points:0});
 if(f.startsAt>=cutoff||!['FT','FINISHED','AET','PEN'].includes(f.status)||f.homeScore==null||f.awayScore==null)continue;
 for(const [t,gf,ga,side] of [[f.home,f.homeScore,f.awayScore,'home'],[f.away,f.awayScore,f.homeScore,'away']]){if(venue&&side!==venue)continue;const r=rows.get(t.id);r.played++;r.goalsFor+=gf;r.goalsAgainst+=ga;r.wins+=Number(gf>ga);r.draws+=Number(gf===ga);r.losses+=Number(gf<ga);r.points+=gf>ga?3:gf===ga?1:0;}}
 if(![...rows.values()].some(r=>r.played>0))return [];
 return [...rows.values()].map(r=>({...r,goalDifference:r.goalsFor-r.goalsAgainst})).sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||a.team.name.localeCompare(b.team.name)).map((r,i)=>({...r,position:i+1}));
}
/** Resolve within ms or fall back (optional sections must never hold a match page open). */
const bounded=(promise,ms,fallback)=>Promise.race([promise.catch(()=>fallback),new Promise(r=>setTimeout(()=>r(fallback),ms))]);
/**
 * Essential match read (the first request a match page makes): stored fixture, score/period, freshness, the saved
 * estimate and the recommendation. Bounded indexed reads only; never captures, refreshes or calls providers.
 */
export async function matchEssential(service,id){
 const s=service.store,row=await s.one('SELECT payload,updated_at FROM fixtures WHERE id=?',id);if(!row)return{unavailable:true};
 const fixture=withMatchState(JSON.parse(row.payload),s.now()),cutoff=analysisCutoff(fixture,s.now()),history=await service.history(fixture.home.id,fixture.away.id,cutoff,fixture.id);
 const analysis=await savedEstimate(service,fixture,history,{capture:false});
 const conflicts=await s.all("SELECT c.* FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",id);
 if(conflicts.length&&matchState(fixture,s.now()).previewAllowed){analysis.historical=true;analysis.needsRefresh=true;analysis.label='Awaiting verification';analysis.reason='Sources disagree. Any saved prediction shown here is an earlier record, pending verification.';}
 const ai=(await s.cache(`ai-explain:${id}`))?.data??null,aiExplanation=ai&&ai.forecastId&&analysis?.archive?.selected?.id===ai.forecastId?ai:null;
 const research=(await s.cache(`research:${id}`))?.data??null;
 return{essential:true,fixture,updatedAt:row.updated_at,cutoff,analysis,conflicts,aiExplanation,research,recommendation:decideRecommendation(fixture,analysis,s.now())};
}

export async function matchContext(service,id){
 const s=service.store,row=await s.one('SELECT payload,updated_at FROM fixtures WHERE id=?',id);if(!row)return{unavailable:true};
 const fixture=withMatchState(JSON.parse(row.payload),s.now()),cutoff=analysisCutoff(fixture,s.now()),history=await service.history(fixture.home.id,fixture.away.id,cutoff,fixture.id);
 const season=await service.deduplicateFixtures((await s.all('SELECT payload FROM fixtures WHERE competition_id=? AND season_id=?',fixture.competition?.id,fixture.seasonId)).map(r=>JSON.parse(r.payload)));
 const details={};for(const table of ['lineups','injuries','fixture_events','fixture_statistics'])details[table]=(await s.all(`SELECT payload FROM ${table} WHERE fixture_id=?`,id)).flatMap(r=>JSON.parse(r.payload));
 // Confirmed team sheets from another provider's record of this same match (canonical fixture, kickoff within 15 min).
 if(!details.lineups.length){const {siblingLineups}=await import('./probable-lineup.mjs');details.lineups=(await siblingLineups(s,fixture)).flatMap(x=>x.data);}
 const teamForm=t=>({team:t,overall:form(history,t.id,cutoff),home:form(history,t.id,cutoff,'home'),away:form(history,t.id,cutoff,'away'),fixtures:historyFor(history,t.id,cutoff).slice(-10).reverse()});
 const analysis=await savedEstimate(service,fixture,history);
 // Two indexed reads per team (team_id; open membership claims via idx_claims_open_field), merged by player id.
 // The former single OR query scanned every claim and exceeded the statement timeout (production 2026-11-27).
 const roster=async team=>{const rows=[...await s.all('SELECT id,payload,name FROM football_players WHERE team_id=?',team.id),...await s.all('SELECT p.id,p.payload,p.name FROM football_players p WHERE p.id IN (SELECT entity_id FROM field_claims WHERE field=? AND valid_to IS NULL AND expires_at>?)','membership:'+team.id,s.now())];const seen=new Map();for(const r of rows)if(!seen.has(r.id))seen.set(r.id,r);return [...seen.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(r=>JSON.parse(r.payload));};
 const rosters=[];for(const team of [fixture.home,fixture.away])rosters.push({team,players:await bounded(roster(team),4000,[])});
 const h2h=headToHead(history,fixture.home.id,fixture.away.id,cutoff);
 const coverage=[['Player membership',rosters.some(r=>r.players.length>0),'Fixture-dated squad membership is unavailable.'],['Historical form',historyFor(history,fixture.home.id,cutoff).length>=3&&historyFor(history,fixture.away.id,cutoff).length>=3,'Earlier completed seasons are needed.'],['Head-to-head',h2h.games>0,'No earlier meetings imported.'],['Venue',!!fixture.venue,'No fixture-specific venue claim retrieved.'],['Team sheets',details.lineups.length>0,'No permitted provider has returned a confirmed team sheet.'],['Availability',details.injuries.length>0,'No verified injury or suspension evidence retrieved.'],['Events',details.fixture_events.length>0,'The result source contains scores, not event coverage.'],['Statistics',details.fixture_statistics.length>0,'No match statistics returned by a permitted source.']].map(([name,available,reason])=>({name,available,reason:available?null:reason}));
 const conflicts=await s.all("SELECT c.* FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",id);
 if(conflicts.length&&matchState(fixture,s.now()).previewAllowed){analysis.historical=true;analysis.needsRefresh=true;analysis.label='Awaiting verification';analysis.reason='Sources disagree. Any saved prediction shown here is an earlier record, pending verification.';}
 // AI-written explanation of the saved pre-match forecast (ungrounded, validated against its facts), when one exists.
 const ai=(await s.cache(`ai-explain:${id}`))?.data??null,aiExplanation=ai&&ai.forecastId&&analysis?.archive?.selected?.id===ai.forecastId?ai:null;
 // Pre-match research (OpenAI web search), shown with its cited sources; context only, probabilities unchanged.
 const research=(await s.cache(`research:${id}`))?.data??null;
 return{aiExplanation,research,fixture,recommendation:decideRecommendation(fixture,analysis,s.now()),probableLineups:await lineupContext(s,fixture),rosters,conflicts,updatedAt:row.updated_at,cutoff,analysis,form:[teamForm(fixture.home),teamForm(fixture.away)],h2h,table:{label:'Incomplete reconstructed table; not official standings. Generic points/goal-difference order excludes competition-specific tie-breaks, deductions and unrecorded matches',cutoff,rows:deriveTable(season,cutoff)},details,coverage,completeness:Math.round(100*coverage.filter(c=>c.available).length/coverage.length),sources:(await service.deduplicateFixtures((await s.all('SELECT payload FROM fixtures WHERE id=? OR id IN (SELECT fixture_id FROM fixture_identities WHERE canonical_id=(SELECT canonical_id FROM fixture_identities WHERE fixture_id=?))',id,id)).map(r=>JSON.parse(r.payload))))[0]?.sourceClaims??[]};
}
