import {lineupContext} from './probable-lineup.mjs';
import {historyFor,form,headToHead} from './model.mjs';
import {originalAnalysis} from './temporal.mjs';

// Opaque Unicode-safe route tokens avoid encoding already encoded provider IDs.
export const routeToken=id=>'id-'+Array.from(new TextEncoder().encode(id),b=>b.toString(16).padStart(2,'0')).join('');
export function providerId(token){if(!/^id-(?:[0-9a-f]{2})+$/i.test(token??''))return typeof token==='string'&&!token.includes(':')&&/%3a/i.test(token)?decodeURIComponent(token):token;return new TextDecoder().decode(Uint8Array.from(token.slice(3).match(/../g),h=>parseInt(h,16)));}
export function deriveTable(fixtures,cutoff,venue=null){
 const rows=new Map();
 for(const f of fixtures){for(const t of [f.home,f.away])if(!rows.has(t.id))rows.set(t.id,{team:t,played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,points:0});
 if(f.startsAt>=cutoff||!['FT','FINISHED','AET','PEN'].includes(f.status)||f.homeScore==null||f.awayScore==null)continue;
 for(const [t,gf,ga,side] of [[f.home,f.homeScore,f.awayScore,'home'],[f.away,f.awayScore,f.homeScore,'away']]){if(venue&&side!==venue)continue;const r=rows.get(t.id);r.played++;r.goalsFor+=gf;r.goalsAgainst+=ga;r.wins+=Number(gf>ga);r.draws+=Number(gf===ga);r.losses+=Number(gf<ga);r.points+=gf>ga?3:gf===ga?1:0;}}
 return [...rows.values()].map(r=>({...r,goalDifference:r.goalsFor-r.goalsAgainst})).sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||a.team.name.localeCompare(b.team.name)).map((r,i)=>({...r,position:i+1}));
}
export async function matchContext(service,id){
 const s=service.store,row=await s.one('SELECT payload,updated_at FROM fixtures WHERE id=?',id);if(!row)return{unavailable:true};
 const fixture=JSON.parse(row.payload),cutoff=Math.min(s.now(),fixture.startsAt),history=await service.history(fixture.home.id,fixture.away.id);
 const season=await service.deduplicateFixtures((await s.all('SELECT payload FROM fixtures WHERE season_id=?',fixture.seasonId)).map(r=>JSON.parse(r.payload)));
 const details={};for(const table of ['lineups','injuries','fixture_events','fixture_statistics'])details[table]=(await s.all(`SELECT payload FROM ${table} WHERE fixture_id=?`,id)).flatMap(r=>JSON.parse(r.payload));
 const teamForm=t=>({team:t,overall:form(history,t.id,cutoff),home:form(history,t.id,cutoff,'home'),away:form(history,t.id,cutoff,'away'),fixtures:historyFor(history,t.id,cutoff).slice(-10).reverse()});
 const snapshots=await s.all("SELECT payload,as_of FROM prematch_snapshots WHERE fixture_id=? AND status='captured' ORDER BY as_of DESC LIMIT 1",id);
 const analysis=fixture.startsAt>s.now()?originalAnalysis(fixture,history,{asOf:cutoff}):{label:'Historical result',reason:'No original prediction is claimed for this completed match. Form and tables below use only earlier matches.',snapshot:snapshots[0]??null};
 const rosters=[];for(const team of [fixture.home,fixture.away])rosters.push({team,players:(await s.all("SELECT DISTINCT p.payload FROM football_players p WHERE p.team_id=? OR p.id IN (SELECT entity_id FROM field_claims WHERE field=? AND valid_to IS NULL AND expires_at>?) ORDER BY p.name",team.id,'membership:'+team.id,s.now())).map(r=>JSON.parse(r.payload))});
 const h2h=headToHead(history,fixture.home.id,fixture.away.id,cutoff);
 const coverage=[['Player membership',rosters.every(r=>r.players.length>0),'No player membership records retrieved.'],['Historical form',historyFor(history,fixture.home.id,cutoff).length>=3&&historyFor(history,fixture.away.id,cutoff).length>=3,'Earlier completed seasons are needed.'],['Head-to-head',h2h.games>0,'No earlier meetings imported.'],['Venue',!!fixture.venue,'No fixture-specific venue claim retrieved.'],['Team sheets',details.lineups.length>0,'No permitted provider has returned a confirmed team sheet.'],['Availability',details.injuries.length>0,'No verified injury or suspension evidence retrieved.'],['Events',details.fixture_events.length>0,'The result source contains scores, not event coverage.'],['Statistics',details.fixture_statistics.length>0,'No match statistics returned by a permitted source.']].map(([name,available,reason])=>({name,available,reason:available?null:reason}));
 const conflicts=await s.all("SELECT c.* FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",id);
 if(conflicts.length&&fixture.startsAt>s.now()){analysis.probabilities=null;analysis.label='Awaiting verification';analysis.reason='Fixture claims disagree. A primary probability is withheld until the conflict is resolved.';}
 return{fixture,probableLineups:await lineupContext(s,fixture),rosters,conflicts,updatedAt:row.updated_at,cutoff,analysis,form:[teamForm(fixture.home),teamForm(fixture.away)],h2h,table:{label:'Derived from recorded results; unofficial, excludes deductions and unrecorded matches',cutoff,rows:deriveTable(season,cutoff)},details,coverage,completeness:Math.round(100*coverage.filter(c=>c.available).length/coverage.length),sources:(await service.deduplicateFixtures((await s.all('SELECT payload FROM fixtures WHERE id=? OR id IN (SELECT fixture_id FROM fixture_identities WHERE canonical_id=(SELECT canonical_id FROM fixture_identities WHERE fixture_id=?))',id,id)).map(r=>JSON.parse(r.payload))))[0]?.sourceClaims??[]};
}
