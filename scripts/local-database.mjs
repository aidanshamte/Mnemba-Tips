import {DatabaseSync} from 'node:sqlite';
import {readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function populatedLocalDatabase(){
 const root=resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
 const candidates=[];
 for(const name of readdirSync(root).filter(n=>n.endsWith('.sqlite'))){const path=join(root,name),db=new DatabaseSync(path,{readOnly:true});try{if(db.prepare("SELECT name FROM sqlite_master WHERE name='fixtures'").get())candidates.push({path,count:db.prepare('SELECT COUNT(*) n FROM fixtures').get().n});}finally{db.close();}}
 candidates.sort((a,b)=>b.count-a.count);if(!candidates[0]?.count)throw Error('No populated local database found. Inspect backups before importing.');
 return candidates[0].path;
}
