import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PilotAuth, SESSION_COOKIE, isLoopbackAddress, parseCookies, serializeCookie } from '../packages/dsh-pilot/src/host/auth.mjs';
import { createPilotHandler } from '../packages/dsh-pilot/src/host/routes.mjs';

/** 鏈€灏忓涓绘枃妗ｆ浛韬?*/
function fakeStore(settings = {}) {
  const doc = { version: 1, settings: { ...settings }, tasks: {}, updatedAt: 't0' };
  return {
    snapshot: () => doc,
    mutate: async (change) => { change(doc); doc.updatedAt = 't1'; return doc; },
  };
}

/** 鏋勯€犱竴涓€屾潵鑷粰瀹氳繙绔湴鍧€銆嶇殑鍋囪姹傦紝鍙粰 authorize 鐢ㄣ€?*/
function fakeRequest(remoteAddress = '127.0.0.1', headers = {}) {
  return { socket: { remoteAddress }, headers };
}

async function withServer(auth, run) {
  const server = http.createServer(createPilotHandler(fakeStore({ defaultPage: 'workbench' }), () => ({ name: 'Pilot' }), auth));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/pilot`;
  try {
    await run(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function tempAuth(cleanup) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pilot-auth-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const auth = new PilotAuth(path.join(dir, 'auth.json'));
  await auth.open();
  return auth;
}

test('isLoopbackAddress covers IPv4, IPv6 and mapped forms', () => {
  for (const value of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(value), true, value);
  for (const value of ['10.0.0.5', '192.168.1.9', '::ffff:10.0.0.5', '0.0.0.0', '', undefined]) assert.equal(isLoopbackAddress(value), false, String(value));
});

test('cookie helpers round-trip a signed session value', () => {
  const header = serializeCookie(SESSION_COOKIE, 'v1.123.abc', { maxAge: 1000 });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.deepEqual(parseCookies(`${SESSION_COOKIE}=v1.123.abc; other=1`), { [SESSION_COOKIE]: 'v1.123.abc', other: '1' });
});

test('loopback mode allows loopback and refuses remote', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    assert.equal(auth.mode, 'loopback');
    assert.deepEqual(auth.authorize(fakeRequest('127.0.0.1')), { ok: true, via: 'loopback' });
    const denied = auth.authorize(fakeRequest('10.0.0.5'));
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'remote-not-allowed');
  } finally {
    for (const fn of cleanup) await fn();
  }
});

test('password mode requires a credential only for remote clients', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    await auth.setPassword('correct horse battery');
    await auth.setMode('password');
    assert.equal(auth.authorize(fakeRequest('127.0.0.1')).ok, true);
    assert.equal(auth.authorize(fakeRequest('10.0.0.5')).reason, 'missing-credential');

    const session = auth.createSession();
    const viaCookie = auth.authorize(fakeRequest('10.0.0.5', { cookie: `${SESSION_COOKIE}=${session}` }));
    assert.deepEqual(viaCookie, { ok: true, via: 'session' });
    // 绛惧悕琚鏀圭殑浼氳瘽涓嶆斁琛?    assert.equal(auth.authorize(fakeRequest('10.0.0.5', { cookie: `${SESSION_COOKIE}=${session}x` })).ok, false);
    // 杩囨湡浼氳瘽涓嶆斁琛?    assert.equal(auth.authorize(fakeRequest('10.0.0.5', { cookie: `${SESSION_COOKIE}=${auth.createSession(Date.now() - 40 * 24 * 3600 * 1000)}` })).ok, false);

    const token = await auth.rotateToken();
    assert.deepEqual(auth.authorize(fakeRequest('10.0.0.5', { authorization: `Bearer ${token}` })), { ok: true, via: 'token' });
    assert.equal(auth.authorize(fakeRequest('10.0.0.5', { authorization: 'Bearer nope' })).ok, false);
  } finally {
    for (const fn of cleanup) await fn();
  }
});

test('login endpoint issues a session cookie and rejects a wrong password', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    await auth.setPassword('pilot-password');
    await auth.setMode('password');
    await withServer(auth, async (base) => {
      const wrong = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'nope' }),
      });
      assert.equal(wrong.status, 401);

      const ok = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'pilot-password' }),
      });
      assert.equal(ok.status, 200);
      const cookie = ok.headers.get('set-cookie');
      assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));

      const tasks = await fetch(`${base}/tasks`);
      assert.equal(tasks.status, 200);

      const state = await (await fetch(`${base}/auth/state`)).json();
      assert.equal(state.mode, 'password');
      assert.equal(state.hasPassword, true);
      assert.equal(state.authed, true);
    });
  } finally {
    for (const fn of cleanup) await fn();
  }
});

test('session survives a process restart', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    await auth.setPassword('pilot-password');
    await auth.setMode('password');
    const session = auth.createSession();
    const reopened = new PilotAuth(auth.file);
    await reopened.open();
    assert.equal(reopened.authorize(fakeRequest('10.0.0.5', { cookie: `${SESSION_COOKIE}=${session}` })).ok, true);
    assert.equal(await reopened.verifyPassword('pilot-password'), true);
    assert.equal(reopened.verifyPassword('other'), false);
  } finally {
    for (const fn of cleanup) await fn();
  }
});

test('auth write endpoints reject an over-short password and keep state consistent', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    await withServer(auth, async (base) => {
      const short = await fetch(`${base}/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: '123' }),
      });
      assert.equal(short.status, 400);
      const ok = await fetch(`${base}/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'long-enough-password' }),
      });
      assert.equal(ok.status, 200);
      const state = await (await fetch(`${base}/auth/state`)).json();
      assert.equal(state.hasPassword, true);
    });
  } finally {
    for (const fn of cleanup) await fn();
  }
});

test('auth endpoints are reachable before login but business routes still work on loopback', async () => {
  const cleanup = [];
  try {
    const auth = await tempAuth(cleanup);
    await withServer(auth, async (base) => {
      assert.equal((await fetch(`${base}/auth/state`)).status, 200);
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal((await fetch(`${base}/info`)).status, 200);
      assert.equal((await fetch(`${base}/unknown`)).status, 404);
    });
  } finally {
    for (const fn of cleanup) await fn();
  }
});


