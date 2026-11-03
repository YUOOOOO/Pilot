import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const root = fileURLToPath(new URL('..', import.meta.url));
const data = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'pilot-smoke-'));
const env = { ...process.env, PILOT_TEST_HOME: data, PILOT_NODE_PATH: process.env.PILOT_NODE_PATH || process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv[2] ? path.resolve(process.argv[2]) : electron;
const args = process.argv[2] ? ['--smoke'] : [path.join(root, 'apps/desktop'), '--smoke'];
for (let run = 1; run <= 2; run++) {
  console.log(`Desktop smoke ${run}/2`);
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd: root, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Smoke timed out. Logs: ${data}`)); }, 120_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Smoke failed (${code}). Logs: ${data}`)); });
  });
  const result = JSON.parse(await readFile(path.join(data, 'smoke-result.json'), 'utf8'));
  if (result.errors || result.homeEntry || result.info?.name !== 'Pilot') throw new Error(`Pilot UI did not activate. Logs: ${data}`);
  const log = await readFile(path.join(data, 'logs/pilot.log'), 'utf8');
  if (log.includes('Conversation navigation failed') || log.includes('Renderer smoke check failed')) throw new Error(`Renderer interaction failed. Logs: ${data}`);
  if ((log.match(/Host exit: \{"code":0,"signal":null,"expected":true\}/g) || []).length !== run) throw new Error(`Host did not shut down cleanly. Logs: ${data}`);
  if ((log.match(/Pilot sidebar collapse, settings and new-session checks passed/g) || []).length !== run) throw new Error(`Sidebar interaction checks failed. Logs: ${data}`);
}
console.log(`Desktop startup and restart passed. Evidence: ${data}`);
