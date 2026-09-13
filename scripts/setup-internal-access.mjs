import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const path='.env.local';
if (!existsSync(path) || !/^MNEMBA_INTERNAL_TOKEN=/m.test(readFileSync(path,'utf8'))) {
  appendFileSync(path,`\nMNEMBA_INTERNAL_TOKEN=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
}
console.log('Local control credential ready; its value is never sent to the browser. Restart the server to load it.');
