import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

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

export class DshHost extends EventEmitter {
  child;
  stopping = false;
  constructor({ node, entry, home, patch, lifecycle, cwd, log, timeout = 90_000 }) {
    super();
    Object.assign(this, { node, entry, home, patch, lifecycle, cwd, log, timeout });
  }
  async start() {
    if (this.child) throw new Error('DSH 已经启动');
    this.stopping = false;
    const args = ['--import', pathToFileURL(this.lifecycle).href, this.entry, 'web', '--patch', this.patch, '--host', '127.0.0.1', '--port', '0', '--no-open'];
    const child = spawn(this.node, args, { cwd: this.cwd, env: childEnvironment(this.home), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let checking = false;
      const abort = new AbortController();
      const finish = (error, url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) { abort.abort(); reject(error); } else resolve(url);
      };
      const timer = setTimeout(() => finish(new Error('DSH 启动超时，请查看日志')), this.timeout);
      for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
        const decoder = new StringDecoder('utf8');
        let buffer = '';
        stream.on('data', chunk => {
          buffer += decoder.write(chunk);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop().slice(-65536);
          for (const line of lines) {
            this.log(`[${name}] ${redact(line)}`);
            const url = launchUrl(line);
            if (!url || checking || settled) continue;
            checking = true;
            void (async () => {
              while (!settled && !this.stopping) {
                try {
                  // Verify the advertised auth URL, but leave its cookie exchange to Chromium.
                  const response = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2500)]), redirect: 'manual' });
                  await response.body?.cancel();
                  if (response.status >= 200 && response.status < 400) { finish(null, url); return; }
                } catch { /* Wait for the server to finish binding. */ }
                await new Promise(r => setTimeout(r, 200));
              }
            })();
          }
        });
        stream.on('end', () => { if (buffer) this.log(`[${name}] ${redact(buffer + decoder.end())}`); });
      }
      child.once('error', error => { this.child = undefined; finish(error); });
      child.once('exit', (code, signal) => {
        abort.abort();
        this.child = undefined;
        finish(new Error(`DSH 已退出（${code ?? signal}），请查看日志`));
        this.emit('exit', { code, signal, expected: this.stopping });
      });
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
      if (process.platform === 'win32') {
        await new Promise(resolve => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', resolve);
          killer.once('exit', resolve);
        });
      } else child.kill('SIGTERM');
      await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
