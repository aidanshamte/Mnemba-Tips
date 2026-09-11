// Repairs only the documented parser defect; fixture IDs and evidence revisions survive.
import {database} from '../tests/football-db.mjs';
import {IntelligenceService} from '../lib/football/intelligence.mjs';
import {normalizeOpenFile} from '../lib/football/adapters.mjs';
import {readdirSync} from 'node:fs';
const root='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const path=readdirSync(root).find(p=>p.endsWith('.sqlite')&&p!=='metadata.sqlite');
const {store:s,sqlite}=database(`${root}/${path}`),service=new IntelligenceService(s);
const owner=await s.lock('football-sync',600000);if(!owner)throw Error('Synchronization busy');
try{
 const entry=await s.one("SELECT * FROM source_files WHERE repository='deutschland' AND path='2025-26/1-bundesliga.txt'");
 const cached=await s.one('SELECT body FROM http_response_cache WHERE url=?',entry.url);if(!cached)throw Error('Source cache required');
 const fresh=(await normalizeOpenFile(cached.body,entry)).fixtures;
 const clean=name=>name.replace(/^\d{1,2}:\d{2}\s+/,'').replace(/^\(\d+[-:]\d+\)\s+/,'').trim();
 let repaired=0;
 for(const row of await s.all('SELECT id,payload FROM fixtures WHERE json_extract(payload,\'$.sourceUrl\')=?',entry.url)){
  const old=JSON.parse(row.payload);if(clean(old.home.name)===old.home.name&&clean(old.away.name)===old.away.name)continue;
  const matches=fresh.filter(f=>f.startsAt===old.startsAt&&f.home.name===clean(old.home.name)&&f.away.name===clean(old.away.name));if(matches.length!==1)throw Error('Ambiguous correction '+row.id);
  const f={...matches[0],id:old.id,externalId:old.externalId};await service.saveTeam(f.home);await service.saveTeam(f.away);
  await s.run('UPDATE fixtures SET home_team_id=?,away_team_id=?,payload=?,updated_at=? WHERE id=?',f.home.id,f.away.id,JSON.stringify(f),s.now(),f.id);await service.evidence.observeFixture(f);repaired++;
 }
 let removed=0;for(const t of await s.all("SELECT id,name FROM football_teams WHERE provider='openfootball'")){if(clean(t.name)===t.name)continue;if(await s.one('SELECT id FROM fixtures WHERE home_team_id=? OR away_team_id=?',t.id,t.id))continue;await s.batch([['DELETE FROM season_teams WHERE team_id=?',t.id],['DELETE FROM team_form WHERE id=?',t.id],['DELETE FROM football_teams WHERE id=?',t.id]]);removed++;}
 console.log(JSON.stringify({repaired,removedMalformedUnusedTeams:removed}));
}finally{await s.unlock('football-sync',owner);sqlite.close();}
