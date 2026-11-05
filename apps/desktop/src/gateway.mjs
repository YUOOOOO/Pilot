// Pilot 入口网关：远程访问时的唯一入口。
//
// 为什么需要它：Pilot 的 DSH Host 只绑回环地址，而 dsh-knowledge 插件的 `/knowledge/*`
// 路由自带「无鉴权」设计（GET /knowledge/config 还会返回明文 API Key），Pilot 插件里拦不到。
// 所以远程模式不在 Host 上开口子，而是在它前面放一个网关：
//
//   浏览器 ──(Pilot 登录 Cookie)──> 网关 ──(本机回环)──> dsh web
//
// 网关负责：登录页 / 会话 Cookie / 全路由校验（含 WebSocket 升级）、知识库密钥打码、
// MinerU 托管接口的本地限制。它只监听一个具体地址（和 DSH 一样拒绝 0.0.0.0），
// 并且要求密码模式已经设置，否则拒绝启动——宁可不启动，也不裸奔。
import http from 'node:http';
import net from 'node:net';
import { isLoopbackAddress, serializeCookie, SESSION_COOKIE } from '../../../packages/dsh-pilot/src/host/auth.mjs';

/** 打码占位符：读接口返回它，写接口把它剥掉（等于「保持不变」）。 */
export const SECRET_SENTINEL = '__PILOT_SECRET_UNCHANGED__';
/** 需要在网关上打码的配置字段（dsh-knowledge 的明文密钥）。 */
export const SECRET_KEYS = new Set(['embeddingApiKey', 'rerankApiKey', 'mineruApiKey', 'mineruLocalApiKey', 'imageCaptionApiKey']);
/** 只有本机才允许操作的托管接口前缀。 */
export const MANAGED_PREFIX = '/knowledge/processors/managed/';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const MAX_BUFFER = 2 * 1024 * 1024;
const MAX_BODY = 1024 * 1024;

/** 把 JSON 里非空的密钥字段换成占位符（返回新对象）。 */
export function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key) && typeof item === 'string' && item !== '') out[key] = SECRET_SENTINEL;
    else out[key] = maskSecrets(item);
  }
  return out;
}

/** 把占位符字段整个删掉，交给上游沿用旧值。 */
export function stripMasked(value) {
  if (Array.isArray(value)) return value.map(stripMasked);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === SECRET_SENTINEL) continue;
    out[key] = stripMasked(item);
  }
  return out;
}

/** 非回环地址一律不允许访问 MinerU 托管接口（等价于上游的 local_management_only）。 */
export function isManagedRouteBlocked(req) {
  return !isLoopbackAddress(req?.socket?.remoteAddress);
}

function safeRedirect(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return '/';
  if (target.startsWith('/__pilot/')) return '/';
  return target;
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body-too-large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function loginPage({ error = '', next = '/' } = {}) {
  const message = error ? `<p class="error">${error}</p>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pilot 登录</title><style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e8eb;
font:15px/1.6 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{width:min(360px,86vw);padding:32px 28px;border:1px solid #23262d;border-radius:14px;background:#15181e}
h1{margin:0 0 6px;font-size:19px;font-weight:600}
p.sub{margin:0 0 22px;color:#8b919a;font-size:13px}
label{display:block;font-size:13px;color:#a7adb6;margin-bottom:6px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid #2c313a;
background:#0f1115;color:#e6e8eb;font-size:15px;outline:none}
input:focus{border-color:#4c6ef5}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:9px;background:#4c6ef5;color:#fff;
font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#5c7cfa}
p.error{margin:0 0 14px;color:#ff8787;font-size:13px}
</style></head><body><main>
<h1>Pilot</h1><p class="sub">登录后即可继续</p>${message}
<form method="post" action="/__pilot/login">
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}">
<label for="password">访问密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">登录</button>
</form></main></body></html>`;
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function json(res, status, body, headers = {}) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

function isHtmlRequest(req) {
  return String(req.headers.accept || '').includes('text/html');
}

/**
 * 启动网关。
 * @param {object} options
 * @param {string} options.upstream 上游地址（含 DSH 启动 token）
 * @param {import('../../../packages/dsh-pilot/src/host/auth.mjs').PilotAuth} options.auth 鉴权状态机
 * @param {string} [options.listenHost] 监听地址，默认 127.0.0.1；拒绝通配地址
 * @param {number} [options.listenPort] 监听端口，0 = 系统分配
 * @param {boolean} [options.allowLoopback] 本机直连是否免登录（桌面端自身），默认 true
 * @returns {Promise<{ url: string, origin: string, port: number, close(): Promise<void> }>}
 */
export async function startGateway({ upstream, auth, listenHost = '127.0.0.1', listenPort = 0, allowLoopback = true }) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:') throw new Error('gateway: upstream must be http');
  const upstreamToken = target.searchParams.get('token') || '';
  const upstreamHost = target.hostname;
  const upstreamPort = Number(target.port || 80);
  const loopbackBind = isLoopbackAddress(listenHost);

  if (!loopbackBind) {
    if (listenHost === '0.0.0.0' || listenHost === '::') throw new Error('gateway: wildcard bind is not supported');
    if (auth.mode !== 'password' || !auth.hasPassword) {
      throw new Error('gateway: remote bind requires auth mode "password" with a password set');
    }
  }

  const sockets = new Set();

  function cookieFor(req, value, maxAge) {
    const secure = Boolean(req.socket?.encrypted) || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    return serializeCookie(SESSION_COOKIE, value, { maxAge, secure });
  }

  function authorized(req, url) {
    if (loopbackBind && allowLoopback && isLoopbackAddress(req.socket?.remoteAddress)) return true;
    return auth.authorizeCredential(req, url).ok;
  }

  async function handleMeta(req, res, url) {
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/__pilot/login') {
      return html(res, 200, loginPage({ next: safeRedirect(url.searchParams.get('next') || '/') }));
    }
    if (req.method === 'POST' && pathname === '/__pilot/login') {
      const raw = await readBody(req);
      const type = String(req.headers['content-type'] || '');
      let password = '';
      let next = '/';
      if (type.includes('application/json')) {
        const body = JSON.parse(raw.toString('utf8') || '{}');
        password = typeof body.password === 'string' ? body.password : '';
        next = safeRedirect(body.next || '/');
      } else {
        const form = new URLSearchParams(raw.toString('utf8'));
        password = form.get('password') || '';
        next = safeRedirect(form.get('next') || '/');
      }
      const key = req.socket?.remoteAddress || 'unknown';
      const locked = auth.lockedFor(key);
      if (locked > 0) {
        if (type.includes('application/json')) return json(res, 429, { error: 'locked', retryAfterMs: locked });
        return html(res, 429, loginPage({ error: '尝试次数过多，请稍后再试。', next }), { 'retry-after': String(Math.ceil(locked / 1000)) });
      }
      if (!auth.hasPassword) {
        if (type.includes('application/json')) return json(res, 409, { error: 'password-not-set' });
        return html(res, 409, loginPage({ error: '尚未设置访问密码，请在本机打开 Pilot 设置。', next }));
      }
      if (!auth.verifyPassword(password)) {
        auth.recordFailure(key);
        if (type.includes('application/json')) return json(res, 401, { error: 'bad-credentials' });
        return html(res, 401, loginPage({ error: '密码不正确。', next }));
      }
      auth.clearFailures(key);
      const cookie = cookieFor(req, auth.createSession(), 30 * 24 * 60 * 60 * 1000);
      if (type.includes('application/json')) return json(res, 200, { authed: true }, { 'set-cookie': cookie });
      return html(res, 303, '', { location: next, 'set-cookie': cookie });
    }
    if (req.method === 'POST' && pathname === '/__pilot/logout') {
      return html(res, 303, '', { location: '/__pilot/login', 'set-cookie': cookieFor(req, '', 0) });
    }
    if (req.method === 'GET' && pathname === '/__pilot/state') {
      return json(res, 200, auth.state(req, url));
    }
    return null;
  }

  async function proxy(req, res, url) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      headers[key] = value;
    }
    headers['x-forwarded-for'] = `${req.socket?.remoteAddress || ''}`;
    headers['x-forwarded-proto'] = req.socket?.encrypted ? 'https' : 'http';

    const pathname = url.pathname;
    const isIndex = pathname === '/' || pathname === '/index.html';

    // 让 DSH 完成自己的 index 授权：只在该浏览器还没有 DSH Cookie 时补一次 token，
    // 否则 DSH 会反复「换 Cookie → 重定向」，形成循环。
    if (isIndex && upstreamToken && !String(req.headers.cookie || '').includes('dsh-auth-')) {
      url.searchParams.set('token', upstreamToken);
    }

    const wantsConfig = req.method === 'GET' && pathname === '/knowledge/config';
    const writeBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE'
      && (pathname === '/knowledge/config' || /^\/knowledge\/bases\/[^/]+$/.test(pathname));
    const body = writeBody ? await readBody(req) : null;

    const upstreamReq = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: `${pathname}${url.search}`,
      headers: { ...headers, host: req.headers.host || `${upstreamHost}:${upstreamPort}` },
    }, upstreamRes => {
      if (wantsConfig) {
        const chunks = [];
        let size = 0;
        upstreamRes.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BUFFER) { upstreamRes.destroy(); return; }
          chunks.push(chunk);
        });
        upstreamRes.on('end', () => {
          const outHeaders = { ...upstreamRes.headers };
          delete outHeaders['content-length'];
          delete outHeaders['transfer-encoding'];
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const masked = JSON.stringify(maskSecrets(parsed));
            res.writeHead(upstreamRes.statusCode || 502, { ...outHeaders, 'content-length': Buffer.byteLength(masked) });
            res.end(masked);
          } catch {
            res.writeHead(upstreamRes.statusCode || 502, outHeaders);
            res.end(Buffer.concat(chunks));
          }
        });
        upstreamRes.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        return;
      }
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstreamReq.on('error', error => {
      if (!res.headersSent) json(res, 502, { error: 'upstream-unreachable', message: String(error?.message || error) });
      else res.end();
    });
    req.on('aborted', () => upstreamReq.destroy());

    if (body) {
      let outgoing = body;
      if (body.length > 0) {
        try {
          outgoing = Buffer.from(JSON.stringify(stripMasked(JSON.parse(body.toString('utf8')))));
          headers['content-type'] = 'application/json';
          upstreamReq.setHeader('content-type', 'application/json');
          upstreamReq.setHeader('content-length', String(outgoing.length));
        } catch { /* 非 JSON 原样转发 */ }
      }
      upstreamReq.end(outgoing);
    } else {
      req.pipe(upstreamReq);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      const meta = await handleMeta(req, res, url);
      if (meta !== null) return;
      if (!authorized(req, url)) {
        if (isHtmlRequest(req)) {
          return html(res, 303, '', { location: `/__pilot/login?next=${encodeURIComponent(safeRedirect(url.pathname + url.search))}` });
        }
        return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
      }
      if (url.pathname.startsWith(MANAGED_PREFIX) && isManagedRouteBlocked(req)) {
        return json(res, 403, { error: 'local_management_only' });
      }
      await proxy(req, res, url);
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: String(error?.message || error) });
      else res.end();
    }
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // WebSocket 升级：同一套鉴权，然后按字节透传，不解析帧。
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!authorized(req, url)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    const upstreamSocket = net.connect(upstreamPort, upstreamHost, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`);
        else lines.push(`${key}: ${value}`);
      }
      upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamSocket.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n'));
    socket.on('error', () => upstreamSocket.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => { server.off('error', reject); resolve(); });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : listenPort;
  const host = loopbackBind ? '127.0.0.1' : listenHost;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${urlHost}:${port}/`,
    origin: `http://${urlHost}:${port}`,
    port,
    server,
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
