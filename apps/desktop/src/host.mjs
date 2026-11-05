import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync } from 'node:fs';

export function launchUrl(line) {
  const match = line.replace(/\x1b\[[0-9;]*m/g, '').match(/dsh web:\s*(https?:\/\/[^\s]+)/i);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function redact(text) {
  return text.replace(/([?&](?:token|key|secret)=)[^\s&#]+/gi, '$1[redacted]');
}

export function childEnvironment(home) {
  const env = { ...process.env, DSH_HOME: home, NO_COLOR: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

/** 探活：确认某个 dsh web 地址还在服务（用于复用上一次启动留下的 host）。 */
export async function probeHost(url, timeout = 2500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
}

/** 进程是否还活着（Windows 上 process.kill(pid, 0) 也可用）。 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 结束整个进程树（host 会拉起子进程/工具进程）。 */
export async function killTree(pid) {
  if (!isAlive(pid)) return;
  await new Promise(resolve => {
    const killer = process.platform === 'win32'
      ? spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      : spawn('kill', ['-TERM', String(pid)], { stdio: 'ignore' });
    killer.once('error', resolve);
    killer.once('exit', resolve);
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 子进程输出落到文件，父进程按增量读回：这样父进程退出时不会给子进程 EPIPE，host 可以留活复用。 */
export class DshHost extends EventEmitter {
  child;
  stopping = false;
  constructor({ node, entry, home, patch, lifecycle, cwd, log, logFile, timeout = 120_000, trustedHosts = [] }) {
    super();
    Object.assign(this, { node, entry, home, patch, lifecycle, cwd, log, logFile, timeout, trustedHosts });
  }
  async start() {
    if (this.child) throw new Error('DSH 已经启动');
    this.stopping = false;
    // host 日志单独落盘（启动后也继续累积），过大时滚动一次
    if (existsSync(this.logFile) && statSync(this.logFile).size > 8 * 1024 * 1024) renameSync(this.logFile, `${this.logFile}.previous`);
    const fd = openSync(this.logFile, 'a');
    const args = [
      '--import', pathToFileURL(this.lifecycle).href, this.entry, 'web', '--patch', this.patch,
      '--host', '127.0.0.1', '--port', '0', '--no-open',
      ...this.trustedHosts.flatMap(host => ['--trusted-host', host]),
    ];
    const child = spawn(this.node, args, {
      cwd: this.cwd,
      env: childEnvironment(this.home),
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      detached: process.platform === 'win32',
    });
    closeSync(fd);
    child.unref();
    this.child = child;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let checking = false;
      let offset = 0;
      let pumpTimer;
      const finish = (error, url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(pumpTimer);
        if (error) reject(error); else resolve(url);
      };
      const timer = setTimeout(() => finish(new Error('DSH 启动超时，请查看日志')), this.timeout);
      const verify = async url => {
        while (!settled && !this.stopping) {
          if (await probeHost(url)) { finish(null, url); return; }
          await sleep(200);
        }
      };
      const decoder = new StringDecoder('utf8');
      const pump = () => {
        if (settled) return;
        try {
          const text = readFileSync(this.logFile);
          if (text.length > offset) {
            const chunk = decoder.write(text.subarray(offset));
            offset = text.length;
            for (const line of chunk.split(/\r?\n/)) {
              if (!line) continue;
              this.log(`[host] ${redact(line)}`);
              const url = launchUrl(line);
              if (url && !checking && !settled) { checking = true; void verify(url); }
            }
          }
        } catch { /* 日志还没创建完全时下一轮再读 */ }
        pumpTimer = setTimeout(pump, 120);
      };
      child.once('error', error => { this.child = undefined; finish(error); });
      child.once('exit', (code, signal) => {
        this.child = undefined;
        finish(new Error(`DSH 已退出（${code ?? signal}），请查看日志`));
        this.emit('exit', { code, signal, expected: this.stopping });
      });
      pump();
    });
  }
  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    // Ask the adapter to enter the official CLI's graceful signal shutdown.
    if (child.connected) child.send({ type: 'pilot:shutdown' }, () => {});
    let deadline;
    const graceful = await Promise.race([exited.then(() => true), new Promise(r => { deadline = setTimeout(() => r(false), 5000); })]);
    clearTimeout(deadline);
    if (!graceful && child.exitCode === null) {
      await killTree(child.pid);
      await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    }
  }
}
