import {internalHeaders} from './internal-access.mjs';
import {localOrigin} from './local-origin.mjs';
// Real database acceptance evidence, separate from deterministic tests.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
const origin=await localOrigin();
async function get(params){const r=await fetch(origin+'/api/intelligence?'+new URLSearchParams(params),{headers:internalHeaders(),signal:AbortSignal.timeout(120000)});assert.ok(r.ok,`${r.status} ${JSON.stringify(params)}`);return r.json();}
const catalog=await get({view:'catalog'}),overview=await get({view:'overview'}),performance=await get({view:'performance'});
const liga=catalog.competitions.filter(c=>c.name==='La Liga');assert.equal(liga.length,1);assert.ok(liga[0].fixtureCount>0);
const searches={};for(const q of ['La Liga','FC Augsburg','Augsbrg']){const result=await get({view:'global-search',q});assert.ok(result.results.length,q);searches[q]={total:result.total,examples:result.results.slice(0,3)};}
const team=searches['FC Augsburg'].examples.find(r=>r.kind==='team');assert.ok(team);const profile=await get({view:'entity',id:team.url.split('/').at(-1)});assert.equal(profile.entity.name,'FC Augsburg');
const fixtures=await get({view:'fixtures',competition:liga[0].providerIds.join(','),from:new Date().toISOString().slice(0,10)});let estimate=null;
for(const f of fixtures.fixtures.filter(f=>f.startsAt>Date.now()&&f.status==='NS').slice(0,15)){const detail=await get({view:'match-context',id:f.id});if(detail.analysis?.probabilities){estimate={fixture:f,analysis:detail.analysis,form:detail.form.map(t=>({team:t.team.name,games:t.overall.games})),h2h:detail.h2h.games};break;}}
assert.ok(estimate,'Eligible persisted upcoming estimate');assert.equal(estimate.analysis.estimateKind,'exploratory');assert.ok(estimate.analysis.asOf);assert.ok(Math.abs(estimate.analysis.probabilities.reduce((a,b)=>a+b,0)-1)<1e-6);
const firstStory=overview.news[0];assert.ok(firstStory);const article=await get({view:'article',id:firstStory.id});assert.ok(!article.unavailable);
const report={verifiedAt:new Date().toISOString(),origin,counts:overview.counts,competitions:catalog.competitions.map(c=>({name:c.name,records:c.fixtureCount,providerIds:c.providerIds})),searches,estimate,performance,article};
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/release-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify({counts:report.counts,laLiga:liga[0].fixtureCount,searches:Object.keys(searches),estimate:{home:estimate.fixture.home.name,away:estimate.fixture.away.name,probabilities:estimate.analysis.probabilities,asOf:estimate.analysis.asOf},tracked:performance.versions.map(v=>({version:v.version,count:v.count,accuracy:v.accuracy}))},null,2));
