import {saveMedia} from './media-registry.mjs';
import {logoPermission} from './visuals.mjs';
import {safeLogoImage} from './media-policy.mjs';

// Administrative media-only transfer. IDs must already exist in the destination;
// this never creates or reconciles a football identity.
export async function importVerifiedLogos(store, entries, {apply=false}={}) {
 const report=[];
 for(const entry of entries){
  const {entity,media,basis}=entry;
  const table={team:'football_teams',competition:'competitions'}[entity?.type];
  if(!table)throw Error('Invalid logo entity type');
  const target=await store.one(`SELECT name FROM ${table} WHERE id=?`,entity.id);
  if(!target||target.name!==entity.name){report.push({id:entity.id,state:'unresolved',reason:'Destination ID/name differs or is absent'});continue;}
  if(!basis||!logoPermission(media)||!safeLogoImage(media.url,media)||!/^[a-f0-9]{64}$/.test(media.contentHash??'')||media.width<32||media.height<32||!Number.isFinite(media.lastSuccess)||media.lastSuccess>store.now()+60000||media.lastSuccess<store.now()-86400000)throw Error('Fresh decoded image, permission and identity evidence required: '+entity.id);
  if(apply)await saveMedia(store,entity,'badge',media,basis);
  report.push({id:entity.id,state:apply?'persisted':'ready',url:media.url});
 }
 return report;
}
