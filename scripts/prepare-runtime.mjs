import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = path.join(root, '.runtime');
const manifest = JSON.parse(await readFile(path.join(root, 'runtime/manifest.json'), 'utf8'));
if (process.platform !== manifest.platform || process.arch !== manifest.arch) throw new Error('当前发行目标为 Windows x64');
await mkdir(runtime, { recursive: true });
const nodePath = path.join(runtime, 'node.exe');
const filename = 'win-x64/node.exe';
const base = `https://nodejs.org/dist/v${manifest.node}/`;
async function download(url) {
  // Windows PowerShell honors the OS proxy configuration used by desktop users.
  const target = path.join(runtime, `download-${Date.now()}`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/download.ps1'), '-Url', url, '-Destination', target], { stdio: 'inherit', windowsHide: true, timeout: 150000 });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`下载失败 (${code}): ${url}`)));
    });
    return await readFile(target);
  } finally { await rm(target, { force: true }); }
}
console.log(`Preparing Node ${manifest.node} (SHA-256 verified)`);
const sums = (await download(`${base}SHASUMS256.txt`)).toString();
const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(row => row[1] === filename)?.[0];
if (!expected) throw new Error('官方校验清单缺少 node.exe');
let binary;
try { binary = await readFile(nodePath); } catch { /* First preparation. */ }
if (!binary || createHash('sha256').update(binary).digest('hex') !== expected) binary = await download(`${base}${filename}`);
if (createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('Node SHA-256 校验失败');
await writeFile(nodePath, binary);
for (const p of ['package.json', 'package-lock.json', 'apps/desktop/package.json', 'packages/dsh-pilot/package.json']) {
  await mkdir(path.dirname(path.join(runtime, p)), { recursive: true });
  await cp(path.join(root, p), path.join(runtime, p));
}
await cp(path.join(root, 'packages/dsh-pilot/lib'), path.join(runtime, 'packages/dsh-pilot/lib'), { recursive: true });
await cp(path.join(root, 'packages/dsh-pilot/cordis.patch.yml'), path.join(runtime, 'packages/dsh-pilot/cordis.patch.yml'));
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
console.log('Installing locked production runtime');
await new Promise((resolve, reject) => {
  const child = spawn(nodePath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`npm ci exited ${code}`)));
});
await new Promise((resolve, reject) => {
  const child = spawn(nodePath, ['-e', "require('koffi'); require('node-pty'); console.log('Native runtime modules verified')"], { cwd: runtime, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`原生依赖加载失败 (${code})`)));
});
await writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({ ...manifest, nodeSha256: expected }, null, 2));
await rm(path.join(runtime, 'node_modules/pilot-desktop'), { force: true, recursive: true });
await writeFile(path.join(runtime, 'NODE-LICENSE.txt'), await download(`https://raw.githubusercontent.com/nodejs/node/v${manifest.node}/LICENSE`));
await rm(path.join(runtime, 'apps'), { recursive: true, force: true });
console.log('Runtime ready: .runtime');
