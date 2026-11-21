// Dependency-free SHA-256 helper shared by server and client modules. Keeping it separate means client code that
// needs a digest never bundles the HTTP layer or the source registry (server credential configuration).
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
