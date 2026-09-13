import {readFileSync} from 'node:fs';
export function internalHeaders() {
  const line = readFileSync('.env.local','utf8').split('\n').find(line=>line.startsWith('MNEMBA_INTERNAL_TOKEN='));
  const token = process.env.MNEMBA_INTERNAL_TOKEN || line?.slice(line.indexOf('=')+1).trim();
  if (!token) throw Error('Local control token missing. Run node scripts/setup-internal-access.mjs and restart the app.');
  return {Authorization:`Bearer ${token}`};
}
