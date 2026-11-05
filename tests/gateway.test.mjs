import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PilotAuth, SESSION_COOKIE } from '../packages/dsh-pilot/src/host/auth.mjs';
import { SECRET_SENTINEL, isManagedRouteBlocked, maskSecrets, startGateway, stripMasked } from '../apps/desktop/src/gateway.mjs';

/** 假上游：模拟 dsh web 的 index 授权、知识库接口与 WebSocket 升级。 */
async function fakeUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, method: req.method });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'dsh-auth-test=abc; Path=/' });
      return res.end('<html><body>DSH UI</body></html>');
    }
    if (url.pathname === '/knowledge/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        embeddingProvider: 'openai',
        embeddingApiKey: 'sk-secret-embedding',
        rerankApiKey: '',
        topK: 6,
        nested: { mineruApiKey: 'mineru-secret' },
      }));
    }
    if (url.pathname === '/knowledge/config' && req.method === 'PUT') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
      });
      return;
    }
    if (url.pathname.startsWith('/knowledge/processors/managed/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not-found' }));
  });
  server.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.write('hello-from-upstream');
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/?token=dsh-test-token`,
    port,
    seen,
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

async function makeAuth(cleanups) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pilot-gateway-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const auth = new PilotAuth(path.join(dir, 'auth.json'));
  await auth.open();
  await auth.setPassword('gateway-password');
  await auth.setMode('password');
  return auth;
}

function cookie(req) {
  return { cookie: `${SESSION_COOKIE}=${req}` };
}

test('maskSecrets and stripMasked keep secrets out of both directions', () => {
  const masked = maskSecrets({ embeddingApiKey: 'sk-1', rerankApiKey: '', topK: 3, nested: { mineruApiKey: 'm-1' } });
  assert.deepEqual(masked, { embeddingApiKey: SECRET_SENTINEL, rerankApiKey: '', topK: 3, nested: { mineruApiKey: SECRET_SENTINEL } });
  assert.deepEqual(stripMasked({ embeddingApiKey: SECRET_SENTINEL, topK: 3, nested: { mineruApiKey: SECRET_SENTINEL, x: 1 } }), { topK: 3, nested: { x: 1 } });
});

test('isManagedRouteBlocked allows loopback clients only', () => {
  assert.equal(isManagedRouteBlocked({ socket: { remoteAddress: '127.0.0.1' } }), false);
  assert.equal(isManagedRouteBlocked({ socket: { remoteAddress: '::1' } }), false);
  assert.equal(isManagedRouteBlocked({ socket: { remoteAddress: '192.168.1.20' } }), true);
});

test('gateway sends unauthenticated browsers to the login page and JSON clients to 401', async () => {
  const upstream = await fakeUpstream();
  const cleanups = [upstream.close];
  try {
    const auth = await makeAuth(cleanups);
    const gw = await startGateway({ upstream: upstream.url, auth, allowLoopback: false });
    cleanups.push(gw.close);
    const htmlRedirect = await fetch(gw.url, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(htmlRedirect.status, 303);
    assert.match(htmlRedirect.headers.get('location'), /^\/__pilot\/login\?next=/);

    const json401 = await fetch(`${gw.origin}/pilot`, { headers: { accept: 'application/json' } });
    assert.equal(json401.status, 401);

    const page = await fetch(`${gw.origin}/__pilot/login`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /访问密码/);
  } finally {
    for (const fn of cleanups.reverse()) await fn();
  }
});

test('login issues a session cookie that unlocks the proxied UI', async () => {
  const upstream = await fakeUpstream();
  const cleanups = [upstream.close];
  try {
    const auth = await makeAuth(cleanups);
    const gw = await startGateway({ upstream: upstream.url, auth, allowLoopback: false });
    cleanups.push(gw.close);

    const wrong = await fetch(`${gw.origin}/__pilot/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'nope' }),
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${gw.origin}/__pilot/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'gateway-password' }),
      redirect: 'manual',
    });
    assert.equal(ok.status, 303);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));

    const session = /pilot_session=([^;]+)/.exec(setCookie)[1];
    const page = await fetch(gw.url, { headers: { accept: 'text/html', ...cookie(session) } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /DSH UI/);
    // 首次加载补上了 DSH 自己的启动 token
    assert.ok(upstream.seen.some(item => item.url.includes('token=dsh-test-token')));
  } finally {
    for (const fn of cleanups.reverse()) await fn();
  }
});

test('knowledge config is masked on read and the placeholder is stripped on write', async () => {
  const upstream = await fakeUpstream();
  const cleanups = [upstream.close];
  try {
    const auth = await makeAuth(cleanups);
    const gw = await startGateway({ upstream: upstream.url, auth, allowLoopback: false });
    cleanups.push(gw.close);
    const session = auth.createSession();

    const config = await (await fetch(`${gw.origin}/knowledge/config`, { headers: cookie(session) })).json();
    assert.equal(config.embeddingApiKey, SECRET_SENTINEL);
    assert.equal(config.nested.mineruApiKey, SECRET_SENTINEL);
    assert.equal(config.embeddingProvider, 'openai');
    assert.equal(config.topK, 6);

    const written = await (await fetch(`${gw.origin}/knowledge/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...cookie(session) },
      body: JSON.stringify({ embeddingApiKey: SECRET_SENTINEL, topK: 8 }),
    })).json();
    assert.deepEqual(written.received, { topK: 8 });
  } finally {
    for (const fn of cleanups.reverse()) await fn();
  }
});

test('websocket upgrades are authenticated and proxied byte for byte', async () => {
  const upstream = await fakeUpstream();
  const cleanups = [upstream.close];
  try {
    const auth = await makeAuth(cleanups);
    const gw = await startGateway({ upstream: upstream.url, auth, allowLoopback: false });
    cleanups.push(gw.close);
    const session = auth.createSession();

    const denied = await rawUpgrade(gw.port);
    assert.match(denied, /401/);

    const allowed = await rawUpgrade(gw.port, session);
    assert.match(allowed, /101 Switching Protocols/);
    assert.match(allowed, /hello-from-upstream/);
  } finally {
    for (const fn of cleanups.reverse()) await fn();
  }
});

/** 裸 socket 发一次 WebSocket 升级，收集响应直到空闲 150ms。 */
function rawUpgrade(port, session) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    let timer;
    const finish = () => { socket.destroy(); resolve(buffer); };
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('upgrade timeout')); });
    socket.on('connect', () => {
      const lines = ['GET /connection HTTP/1.1', 'Host: localhost', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='];
      if (session) lines.push(`Cookie: ${SESSION_COOKIE}=${session}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1');
      clearTimeout(timer);
      timer = setTimeout(finish, 150);
    });
    socket.on('error', reject);
  });
}
