import {createPool,postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';

// Administrative CLI only. Output belongs in protected operational evidence.
export async function audit(s){
 const at=s.now(),counts={};
 for(const table of ['fixtures','exploratory_estimates','analysis_forecasts','analysis_grades','analysis_grade_audit','football_teams','football_players','media_assets','entity_media'])counts[table]=(await s.one(`SELECT COUNT(*) n FROM ${table}`)).n;
 const verified=await s.all("SELECT e.entity_id FROM entity_media e JOIN media_assets a ON a.id=e.asset_id WHERE a.state='verified' AND a.last_success IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_url_checks c WHERE c.url=a.url AND c.state='failed' AND c.checked_at>=a.last_success)");
 const covered=new Set(verified.map(r=>r.entity_id));
 for(const r of await s.all('SELECT a.provider_id,b.provider_id source FROM entity_aliases a JOIN entity_aliases b ON b.canonical_id=a.canonical_id WHERE a.verified=1 AND b.verified=1'))if(covered.has(r.source))covered.add(r.provider_id);
 const fixtures=await s.all('SELECT payload,updated_at FROM fixtures'),leagues=new Map();
 for(const row of fixtures){const f=JSON.parse(row.payload);if(f.startsAt<at-365*86400000)continue;const key=f.competition.id,l=leagues.get(key)??{id:key,name:f.competition.name,teams:new Set(),fixtures:0,latestUpdate:0};for(const t of [f.home,f.away])l.teams.add(t.id);l.fixtures++;l.latestUpdate=Math.max(l.latestUpdate,row.updated_at);leagues.set(key,l);}
 const players=await s.all('SELECT id FROM football_players');
 return{at,counts,coverage:[...leagues.values()].map(l=>({...l,verifiedImages:[...l.teams].filter(id=>covered.has(id)).length,teams:l.teams.size})),players:{total:players.length,verifiedImages:players.filter(p=>covered.has(p.id)).length},mediaQueue:await s.all('SELECT state,COUNT(*) n FROM media_enrichment GROUP BY state'),retryableFailures:await s.all("SELECT entity_type,COUNT(*) n,MIN(next_attempt) next_retry FROM media_enrichment WHERE state='failed' GROUP BY entity_type"),jobs:await s.all('SELECT * FROM update_jobs ORDER BY last_attempt DESC'),cron:await s.all('SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 12'),sourceUsage:await s.all('SELECT * FROM source_request_usage WHERE day=?',s.day()),sourceStatus:await s.all('SELECT id,last_success,last_error,next_allowed_at FROM source_registry'),fixtureTiming:await s.all("SELECT status,COALESCE(json_extract(payload,'$.kickoffPrecision'),'instant') kickoff_precision,COUNT(*) n FROM fixtures WHERE starts_at>=? GROUP BY status,COALESCE(json_extract(payload,'$.kickoffPrecision'),'instant')",at),acceptance:fixtures.map(r=>({...JSON.parse(r.payload),updatedAt:r.updated_at})).filter(f=>/Betis/i.test(f.home.name)&&/Getafe/i.test(f.away.name)).sort((a,b)=>b.startsAt-a.startsAt).slice(0,3)};
}
if(process.argv[1]?.endsWith('/audit.mjs')){const pool=createPool();try{console.log(JSON.stringify(await audit(new Store(postgresDatabase(pool))),null,2));}finally{await pool.end()}}
