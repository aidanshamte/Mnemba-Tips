import {announceLocal} from './runtime-mode.mjs';
import {rejectOtherServer,acquireServerLease} from './local-origin.mjs';
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...forwardedArgs] = process.argv.slice(2);
const args=forwardedArgs.filter(arg=>arg!=='--');
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
if(command==='dev'){announceLocal();await rejectOtherServer(8787);await acquireServerLease('http://localhost:5173');}
const managedLinux = readExecutionProfile() === "managed-linux";
// Vinext follows Next's --hostname spelling; Vite uses --host.
if (!managedLinux) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host') args[i] = '--hostname';
    else if (args[i].startsWith('--host=')) args[i] = args[i].replace('--host=', '--hostname=');
  }
}

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
