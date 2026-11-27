import {scoreDistribution} from './temporal.mjs';
import {marketOptions,priceMarket,MARKET_SCOPE,settleMarket} from './market-registry.mjs';
import {matchState,analysisCutoff} from './match-state.mjs';
import {savedEstimate} from './estimates.mjs';
import {priorityFor} from './priority-coverage.mjs';
import {matchdayRange,inMatchday} from './matchday.mjs';
import {digest} from './digest.mjs';
import {analysisStates} from './analysis-states.mjs';
import {privateCompetitions} from './identity-migration.mjs';
const LIVE_STATUSES=new Set(['1H','2H','HT','ET','BT','P','LIVE','IN_PLAY','PAUSED']);
export const RULE_VERSION='matchday-preference-2';
// Selection rule v2 (2026-11-27): every supported, priced market is considered (1X2, double chance, BTTS, match totals
// 1.5/2.5/3.5); eligibility first (evidence freshness, sample, category, 60-85% provisional band), then the option
// whose estimate is most above a neutral prior for the same market (support), not the largest raw probability, so an
// almost-certain safety line does not win by default. Draw no bet is excluded (a draw refunds; one 'chance' misleads).
// Alternatives come from different market families (non-redundant), at most two.
const NEUTRAL=scoreDistribution(1.4,1.1),family=o=>o.market==='result'||o.market==='double-chance'?'result':o.market==='btts'?'btts':'total';
export const CANDIDATE=o=>o.market==='result'||o.market==='double-chance'||o.market==='btts'||(o.market==='total'&&o.side==='both'&&[1.5,2.5,3.5].includes(o.line));
export function decideRecommendation(f,a,now=Date.now()){
 const base={decision:'No strong selection',ruleVersion:RULE_VERSION,scope:MARKET_SCOPE,primary:null,alternatives:[],note:'Provisional model preference, not measured accuracy or betting value. All selections can lose. Lineup context is not a numeric input.'};
 if(a?.needsRefresh||a?.historical)return{...base,reason:'Review the saved prediction above. A current selection needs refreshed evidence.'};
 if(!matchState(f,now).previewAllowed)return{...base,reason:'Already started or not scheduled. Review the saved pre-match record; no in-play model is offered.'};
 if(f.hasConflict||!a?.probabilities||!a.expectedGoals)return{...base,reason:a?.reason??'Conflicting or insufficient earlier results.'};
 if(priorityFor(f.competition)?.gender==='women'||/u.?\d{2}|women/i.test(f.competition.name))return{...base,reason:'No validated model for this age/gender category; club-league parameters are not transferred.'};
 const sample=Math.min(a.factors?.home?.games??0,a.factors?.away?.games??0),rest=Math.max(a.factors?.home?.restDays??Infinity,a.factors?.away?.restDays??Infinity);
 if(sample<8||rest>90)return{...base,reason:'Require at least eight earlier matches per team and participation within 90 days.',sample};
 const cells=scoreDistribution(...a.expectedGoals),options=marketOptions().filter(CANDIDATE).map(o=>{const probabilities=priceMarket(cells,o);return{...o,probabilities,support:Number((probabilities.win-priceMarket(NEUTRAL,o).win).toFixed(4))};}).sort((a,b)=>b.support-a.support||b.probabilities.win-a.probabilities.win||JSON.stringify(a).localeCompare(JSON.stringify(b))),qualifying=options.filter(o=>o.probabilities.win>=.6&&o.probabilities.win<=.85&&o.support>=.03),eligible=qualifying.filter((o,i)=>qualifying.findIndex(x=>family(x)===family(o))===i);
 if(!eligible.length)return{...base,reason:'No supported market is both within the 60–85% provisional range and clearly above its neutral baseline.',sample};
 return{...base,decision:'Provisional model preference',primary:eligible[0],alternatives:eligible.slice(1,3),sample,rank:Math.round((eligible[0].probabilities.win-.5)*10000)+sample*10-Math.round(rest),reason:'Strongest support above a neutral baseline among qualifying 1X2, double-chance, both-teams-to-score and match-goals options (60–85% provisional range).',forecastId:a.archive?.selected?.id??null,reasons:a.explanations?.slice(0,2)??[],uncertainty:f.kickoffPrecision==='date'?'Kickoff time unverified; this preview is excluded from tracked accuracy.':'Uncalibrated results/form baseline; confirmed availability may change.',createdAt:a.asOf??now,modelVersion:a.modelVersion};
}
/** Every qualifying entry, strongest first, one per canonical match. No overall or per-league cap (a former
 * .slice(0,5) hid every qualifying match after the fifth); `limit` is only for callers that page explicitly. */
export function rankRecommendations(entries,limit=Infinity){return entries.filter(e=>e.recommendation?.primary).sort((a,b)=>(b.recommendation.rank??0)-(a.recommendation.rank??0)||a.fixture.id.localeCompare(b.fixture.id)).filter((e,i,all)=>all.findIndex(x=>(x.fixture.canonicalId??x.fixture.id)===(e.fixture.canonicalId??e.fixture.id))===i).slice(0,limit);}
const PHASE=f=>LIVE_STATUSES.has(String(f.status))?'in-play':['FT','AET','PEN','FINISHED','AWD','WO'].includes(String(f.status))?'finished':'upcoming';
export async function matchdayView(service,params){
 const s=service.store,range=matchdayRange(params,s.now()),competition=params.get('competition')??'',q=(params.get('q')??'').toLowerCase(),status=params.get('status')??'';
 const scopeKey=JSON.stringify([range.from,range.to,range.zone,competition,q,status]),cacheKey='matchday:'+await digest(scopeKey),cached=await s.cache(cacheKey);if(cached&&!cached.stale)return cached.data;
 const owner=s.readOnly?null:await s.lock(cacheKey,120000);if(!s.readOnly&&!owner)return cached?{...cached.data,refreshing:true}:{range,fixtures:[],count:0,picks:[],loading:true,note:'Preparing this matchday. Please retry shortly.'};
 try{
 const raw=(await s.all("SELECT payload FROM fixtures WHERE starts_at>=? AND starts_at<?",Math.min(range.start,Date.parse(range.from)),Math.max(range.end,Date.parse(range.to)+86400000))).map(r=>JSON.parse(r.payload));
 // Records of private competitions (open identity review, unmapped licensed-provider leagues) stay out of the public
 // list, exactly as on the Leagues page. They remain stored for identity processing.
 const hidden=await privateCompetitions(s,raw.map(f=>f.competition?.id));
 const fixtures=(await service.deduplicateFixtures(raw.filter(f=>!hidden.has(f.competition?.id)))).filter(f=>inMatchday(f,range)&&(!competition||competition.split(',').includes(f.competition.id)||competition===priorityFor(f.competition)?.id)&&(!q||`${f.home.name} ${f.away.name}`.toLowerCase().includes(q))&&(!status||(status==='live'?LIVE_STATUSES.has(f.status):f.status===status)));
 // Precomputed analysis states (scheduled 'analysis-states' stage). Visibility never depends on prediction eligibility.
 const states=await analysisStates(s,fixtures.map(f=>f.id)),analysis={full:0,provisional:0,waiting:0,pending:0};
 // Only future kickoffs can be analysed; a past kickoff still marked not-started awaits a status update, not analysis.
 // Canonical competition for grouping and featured ordering (presentation only; targeted lookups).
 const compIds=[...new Set(fixtures.map(f=>f.competition?.id).filter(Boolean))],compCanon=new Map(),canonName=new Map();
 for(let i=0;i<compIds.length;i+=400){const c=compIds.slice(i,i+400);for(const r of await s.all(`SELECT provider_id,canonical_id FROM entity_aliases WHERE verified=1 AND canonical_id LIKE 'competition:%' AND provider_id IN (${c.map(()=>'?').join(',')})`,...c))compCanon.set(r.provider_id,r.canonical_id);}
 const canonIds=[...new Set(compCanon.values())];for(let i=0;i<canonIds.length;i+=400){const c=canonIds.slice(i,i+400);for(const r of await s.all(`SELECT id,name FROM canonical_entities WHERE id IN (${c.map(()=>'?').join(',')})`,...c))canonName.set(r.id,r.name);}
 for(const f of fixtures){const c=compCanon.get(f.competition?.id);if(c){f.competitionCanonical=c;f.competitionName=canonName.get(c)??f.competition.name;}}
 for(const f of fixtures){const st=states.get(f.id);if(st)f.analysisState={state:st.state,label:st.label,reason:st.reason,main:st.main,sample:st.sample};if(matchState(f,s.now()).previewAllowed&&f.startsAt>s.now())analysis[st?.state??'pending']++;}
 let entries=[];
 const candidates=fixtures.filter(f=>matchState(f,s.now()).previewAllowed&&states.get(f.id)?.recommendation);
 if(states.size){
  // Every qualifying match, from the recommendation the scheduled analysis-states stage stored (no model work in the
  // visitor's request path). Started matches keep the pick that was published before kickoff (below).
  for(const f of candidates){const st=states.get(f.id);entries.push({fixture:f,recommendation:{decision:'Provisional model preference',ruleVersion:st.recommendation.ruleVersion??RULE_VERSION,...st.recommendation},phase:'upcoming',savedAt:st.savedAt??null,modelVersion:st.modelVersion??null,sample:st.sample});}
 }else for(const f of fixtures.filter(f=>priorityFor(f.competition)&&matchState(f,s.now()).previewAllowed)){const history=await service.history(f.home.id,f.away.id,analysisCutoff(f,s.now()),f.id),analysis=await savedEstimate(service,f,history,{capture:false});entries.push({fixture:f,recommendation:decideRecommendation(f,analysis,s.now()),phase:'upcoming',savedAt:analysis.asOf??null,modelVersion:analysis.modelVersion??null});}
 // Picks published before kickoff stay reachable after it, marked in play / finished (never re-created afterwards).
 const startedIds=new Set(fixtures.filter(f=>!matchState(f,s.now()).previewAllowed).map(f=>f.id)),published=new Map();
 if(startedIds.size){for(const row of await s.all('SELECT published_at,payload FROM recommendation_lists WHERE published_at>=? AND published_at<=? ORDER BY published_at',range.start-2*86400000,Math.min(s.now(),range.end))){const sel=JSON.parse(row.payload).selection??[];for(const e of sel)if(startedIds.has(e.fixtureId)&&!published.has(e.fixtureId)&&Number(row.published_at)<e.kickoff&&e.recommendation?.primary)published.set(e.fixtureId,{...e,publishedAt:Number(row.published_at)});}}
 for(const f of fixtures)if(published.has(f.id)){const e=published.get(f.id);entries.push({fixture:f,recommendation:e.recommendation,phase:PHASE(f),savedAt:e.publishedAt,modelVersion:e.modelVersion??null,publishedBeforeKickoff:true});}
 const upcoming=rankRecommendations(entries.filter(e=>e.phase==='upcoming')),started=rankRecommendations(entries.filter(e=>e.phase!=='upcoming')).sort((a,b)=>a.fixture.startsAt-b.fixture.startsAt);
 const picks=[...upcoming,...started.filter(e=>!upcoming.some(u=>(u.fixture.canonicalId??u.fixture.id)===(e.fixture.canonicalId??e.fixture.id)))],original=await s.one('SELECT id,payload,published_at FROM recommendation_lists WHERE scope_key=? ORDER BY published_at LIMIT 1',scopeKey),previous=await s.one('SELECT payload FROM recommendation_lists WHERE scope_key=? ORDER BY published_at DESC LIMIT 1',scopeKey);
 const selection=upcoming.map(e=>({fixtureId:e.fixture.id,canonicalId:e.fixture.canonicalId??e.fixture.id,kickoff:e.fixture.startsAt,tracked:matchState(e.fixture,s.now()).forecastEligible,forecastId:e.recommendation.forecastId??null,home:e.fixture.home.name,away:e.fixture.away.name,recommendation:e.recommendation,evidence:{sample:e.sample??null},modelVersion:e.modelVersion}));
 const signature=JSON.stringify(selection.map(e=>[e.fixtureId,e.forecastId,e.recommendation.primary,e.modelVersion]));let publicationId=null;
 if(!s.readOnly&&selection.length&&(!previous||JSON.parse(previous.payload).signature!==signature)){publicationId=await digest([scopeKey,s.now(),signature]);await s.run('INSERT OR IGNORE INTO recommendation_lists(id,scope_key,published_at,rule_version,payload) VALUES(?,?,?,?,?)',publicationId,scopeKey,s.now(),RULE_VERSION,JSON.stringify({range,signature,selection,scope:scopeKey}));}
 const analysed=analysis.full+analysis.provisional,summary={fixtures:fixtures.length,awaitingKickoff:analysis.full+analysis.provisional+analysis.waiting+analysis.pending,analysed,qualifying:upcoming.length,awaitingAnalysis:analysis.waiting+analysis.pending,notQualifying:Math.max(0,analysed-upcoming.length),startedWithPick:picks.length-upcoming.length,picks:picks.length};
 const result={range,fixtures,count:fixtures.length,analysis,summary,eligible:upcoming.length,picks,picksTotal:picks.length,publicationId,original:original?{id:original.id,publishedAt:original.published_at,...JSON.parse(original.payload)}:null,note:picks.length?'Every qualifying selection for this day. Model probabilities are not a proven hit rate; all selections can lose.':'No qualifying picks yet. Every match is still listed with its analysis state.',updatedAt:s.now()};await s.putCache(cacheKey,result,60000);return result;
 }finally{if(owner)await s.unlock(cacheKey,owner);}
}
export async function gradeRecommendations(service){const s=service.store,lists=await s.all('SELECT * FROM recommendation_lists');let count=0;
 for(const list of lists)for(const pick of JSON.parse(list.payload).selection){const row=await s.one('SELECT payload FROM fixtures WHERE id=?',pick.fixtureId);if(!row)continue;const f=JSON.parse(row.payload),state=matchState(f,s.now());let settlement='pending',reason='Awaiting regulation result';
 const conflict=await s.one("SELECT c.id FROM evidence_conflicts c JOIN fixture_identities i ON i.canonical_id=c.entity_id WHERE i.fixture_id=? AND c.status='open'",f.id);
 if(!pick.tracked){settlement='excluded';reason='Date-only or unverified pre-kickoff timing; exploratory record';}else if(conflict){reason='Conflicting result; pending verification';}else if(f.startsAt!==pick.kickoff||state.state==='cancelled'){settlement='void';reason='Cancelled or rescheduled';}else if(state.state==='completed'){const score=['FT','FINISHED'].includes(f.status)?[f.homeScore,f.awayScore]:f.regulationScore?[f.regulationScore.home,f.regulationScore.away]:[];settlement=settleMarket(pick.recommendation.primary,...score);reason='Regulation-time settlement; extra-time/shootout totals excluded';}
 const payload=JSON.stringify({settlement,reason,homeScore:f.homeScore,awayScore:f.awayScore}),old=await s.one('SELECT id,payload FROM recommendation_grades WHERE list_id=? AND fixture_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1',list.id,f.id);if(old?.payload===payload)continue;
 await s.run('INSERT INTO recommendation_grades(id,list_id,fixture_id,recorded_at,payload) VALUES(?,?,?,?,?)',await digest([list.id,f.id,payload,old?.id]),list.id,f.id,s.now(),payload);count++;
 }return count;
}
export async function shortlistHistory(service,params){const offset=Math.max(0,Number(params.get('offset'))||0),rows=await service.store.all('SELECT * FROM recommendation_lists ORDER BY published_at DESC LIMIT 21 OFFSET ?',offset),lists=[];for(const row of rows.slice(0,20)){const payload=JSON.parse(row.payload);for(const p of payload.selection){const identity=await service.store.one('SELECT home_team_id,away_team_id FROM fixtures WHERE id=?',p.fixtureId);p.homeId=identity?.home_team_id??null;p.awayId=identity?.away_team_id??null;const grade=await service.store.one('SELECT payload FROM recommendation_grades WHERE list_id=? AND fixture_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1',row.id,p.fixtureId);p.grade=grade?JSON.parse(grade.payload):{settlement:'pending'};}lists.push({id:row.id,publishedAt:row.published_at,ruleVersion:row.rule_version,...payload,signature:undefined});}return{lists,nextOffset:rows.length>20?offset+20:null,note:'All published versions remain, including losses. Date-only previews are excluded from measured accuracy. No selection-process hit rate is established.'};}
