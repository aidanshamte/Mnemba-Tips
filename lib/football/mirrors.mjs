// OpenFootball documents football.json as generated from these upstream files.
// Only exact participant IDs within the same season and round are reconciled.
const upstream={
 'en.1.json':['england','1-premierleague.txt'],
 'de.1.json':['deutschland','1-bundesliga.txt'],
 'es.1.json':['espana','1-liga.txt'],
 'it.1.json':['italy','1-seriea.txt'],
};
export async function reconcileGeneratedMirrors(service){
 const s=service.store,files=await s.all("SELECT * FROM source_files WHERE state='imported'"),results={matched:0,unresolved:0};
 for(const json of files.filter(f=>f.repository==='football.json')){
  const mapping=upstream[json.path.split('/').at(-1)];if(!mapping)continue;
  const source=files.find(f=>f.repository===mapping[0]&&f.path===`${json.season}/${mapping[1]}`);if(!source)continue;
  const rows=await s.all("SELECT f.id,f.home_team_id,f.away_team_id,f.payload,i.canonical_id FROM fixtures f JOIN fixture_identities i ON i.fixture_id=f.id WHERE json_extract(f.payload,'$.sourceUrl')=?",json.url);
  const mirrors=await s.all("SELECT id,home_team_id,away_team_id,payload FROM fixtures WHERE json_extract(payload,'$.sourceUrl')=?",source.url);
  for(const mirror of mirrors){const f=JSON.parse(mirror.payload),candidates=rows.filter(r=>r.home_team_id===mirror.home_team_id&&r.away_team_id===mirror.away_team_id&&JSON.parse(r.payload).round===f.round);if(candidates.length!==1){results.unresolved++;continue;}
   await s.run("UPDATE fixture_identities SET canonical_id=?,verification='verified-reference' WHERE fixture_id=?",candidates[0].canonical_id,mirror.id);await service.evidence.conflicts(candidates[0].canonical_id);results.matched++;
  }
 }
 return results;
}
