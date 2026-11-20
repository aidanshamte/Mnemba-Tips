import permission from '../../config/logo-permission.json' with {type:'json'};

// The recorded project-owner grant covers football team/competition artwork.
// It does not establish identity or replace image validation.
export function ownerLogoPermission(){
 if(permission.publicDisplayAllowed!==true||!permission.reference)return {};
 return {publicDisplayAllowed:true,permissionEvidence:permission.reference,usageBasis:'Project-owner permission: '+permission.reference};
}
