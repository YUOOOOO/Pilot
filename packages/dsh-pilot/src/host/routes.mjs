// Pilot 宿主 HTTP 面：挂在 ctx.webServer 的 `/pilot` 前缀下，给浏览器半读写这份文档。
// 只做 JSON；所有非 `/auth/*` 请求先过鉴权（见 host/auth.mjs），不信任任何未校验字段。
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { MODES, SESSION_COOKIE, openAuth, serializeCookie } from './auth.mjs';

const MAX_BODY = 256 * 1024;
const TASK_STATUSES = new Set(['todo', 'doing', 'done']);

/** 多角色群聊插件的数据目录（它把每个群写成 groups/<gid>/group.json） */
function groupchatDir() {
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh');
  return path.join(home, 'plugin-data', 'multi-role-groupchat', 'groups');
}

function send(res, status, body, headers = {}) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

function pickSettings(body) {
  const next = {};
  const source = body && typeof body === 'object' ? body : {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) next[key] = value;
    else if (Array.isArray(value) && value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) next[key] = value.slice(0, 50);
  }
  return next;
}

/** 远程来源的客户端地址（网关转发后取 x-forwarded-for 的第一段），用于限流。 */
function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** 只有 HTTPS（直连 TLS 或网关声明 x-forwarded-proto）才给 Cookie 加 Secure。 */
function isSecure(req) {
  if (req.socket?.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

/**
 * Build the request handler for the `/pilot` prefix.
 * @param {import('./store.mjs').PilotStore} store
 * @param {() => object} info product metadata for GET /pilot/info
 * @param {import('./auth.mjs').PilotAuth} [auth] 鉴权状态机；默认 open（测试/完全信任）
 */
export function createPilotHandler(store, info = () => ({}), auth = openAuth()) {
  return async function pilotHandler(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname.replace(/^\/pilot\/?/, '');
    const segment = pathname.split('/').filter(Boolean);
    try {
      // ── 鉴权面（登录前可访问） ───────────────────────────────────────
      if (segment[0] === 'auth') {
        if (method === 'GET' && segment[1] === 'state') return send(res, 200, auth.state(req, url));
        if (method === 'POST' && segment[1] === 'login') {
          const key = clientKey(req);
          const locked = auth.lockedFor(key);
          if (locked > 0) return send(res, 429, { error: 'locked', retryAfterMs: locked });
          const body = await readJson(req);
          const password = typeof body.password === 'string' ? body.password : '';
          if (!auth.hasPassword) return send(res, 409, { error: 'password-not-set' });
          if (!auth.verifyPassword(password)) {
            auth.recordFailure(key);
            return send(res, 401, { error: 'bad-credentials' });
          }
          auth.clearFailures(key);
          const token = auth.createSession();
          const cookie = serializeCookie(SESSION_COOKIE, token, { maxAge: 30 * 24 * 60 * 60 * 1000, secure: isSecure(req) });
          return send(res, 200, { authed: true }, { 'set-cookie': cookie });
        }
        if (method === 'POST' && segment[1] === 'logout') {
          return send(res, 200, { authed: false }, { 'set-cookie': serializeCookie(SESSION_COOKIE, '', { maxAge: 0 }) });
        }
        // 以下写操作要求：回环来源，或已经通过密码/令牌认证。
        const decision = auth.authorize(req, url);
        if (!decision.ok) return send(res, 401, { error: 'unauthorized', reason: decision.reason }, { 'www-authenticate': 'Bearer' });
        if (method === 'POST' && segment[1] === 'password') {
          const body = await readJson(req);
          if (auth.hasPassword && decision.via !== 'loopback' && !auth.verifyPassword(typeof body.current === 'string' ? body.current : '')) {
            return send(res, 401, { error: 'bad-current-password' });
          }
          if (typeof body.password !== 'string') return send(res, 400, { error: 'password-required' });
          await auth.setPassword(body.password);
          const token = auth.createSession();
          const cookie = serializeCookie(SESSION_COOKIE, token, { maxAge: 30 * 24 * 60 * 60 * 1000, secure: isSecure(req) });
          return send(res, 200, auth.state(req, url), { 'set-cookie': cookie });
        }
        if (method === 'DELETE' && segment[1] === 'password') {
          await auth.clearPassword();
          return send(res, 200, auth.state(req, url));
        }
        if (method === 'POST' && segment[1] === 'mode') {
          const body = await readJson(req);
          if (!MODES.includes(body.mode)) return send(res, 400, { error: 'invalid-mode' });
          if (body.mode === 'password' && !auth.hasPassword) return send(res, 409, { error: 'password-not-set' });
          await auth.setMode(body.mode);
          return send(res, 200, auth.state(req, url));
        }
        if (method === 'POST' && segment[1] === 'token') {
          const token = await auth.rotateToken();
          // 明文令牌只在这一响应里出现一次。
          return send(res, 200, { accessToken: token });
        }
        return send(res, 404, { error: 'not-found', path: pathname });
      }

      // ── 业务面：先鉴权 ───────────────────────────────────────────────
      const decision = auth.authorize(req, url);
      if (!decision.ok) {
        return send(res, 401, { error: 'unauthorized', reason: decision.reason }, { 'www-authenticate': 'Bearer' });
      }

      if (method === 'GET' && segment.length === 0) return send(res, 200, { ...store.snapshot(), product: info(), auth: auth.state(req, url) });
      if (method === 'GET' && segment[0] === 'info') return send(res, 200, info());
      if (method === 'PUT' && segment[0] === 'settings') {
        const body = pickSettings(await readJson(req));
        // 空载荷 = 恢复默认：清空而不是空合并，否则旧的键会一直复活
        const doc = await store.mutate(draft => {
          draft.settings = Object.keys(body).length ? { ...draft.settings, ...body } : {};
        });
        return send(res, 200, { settings: doc.settings, updatedAt: doc.updatedAt });
      }
      if (method === 'GET' && segment[0] === 'tasks') {
        const tasks = Object.values(store.snapshot().tasks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return send(res, 200, { tasks });
      }
      if (method === 'POST' && segment[0] === 'tasks') {
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
        if (!title) return send(res, 400, { error: 'title-required' });
        const status = TASK_STATUSES.has(body.status) ? body.status : 'todo';
        const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        const doc = await store.mutate(draft => {
          draft.tasks[id] = { id, title, status, note: typeof body.note === 'string' ? body.note.slice(0, 2000) : '', createdAt: now, updatedAt: now };
        });
        return send(res, 201, { task: doc.tasks[id] });
      }
      if (segment[0] === 'tasks' && segment[1]) {
        const id = decodeURIComponent(segment[1]);
        if (method === 'PATCH') {
          const body = await readJson(req);
          if (!store.snapshot().tasks[id]) return send(res, 404, { error: 'task-not-found' });
          const doc = await store.mutate(draft => {
            const task = draft.tasks[id];
            if (typeof body.title === 'string' && body.title.trim()) task.title = body.title.trim().slice(0, 200);
            if (TASK_STATUSES.has(body.status)) task.status = body.status;
            if (typeof body.note === 'string') task.note = body.note.slice(0, 2000);
            task.updatedAt = new Date().toISOString();
          });
          return send(res, 200, { task: doc.tasks[id] });
        }
        if (method === 'DELETE') {
          if (!store.snapshot().tasks[id]) return send(res, 404, { error: 'task-not-found' });
          await store.mutate(draft => { delete draft.tasks[id]; });
          return send(res, 200, { deleted: id });
        }
      }
      if (method === 'GET' && segment[0] === 'groupchat' && segment.length === 1) {
        // 只读多角色群聊插件的群清单：它自己的路由挂在 Connection 上，浏览器半够不到，
        // 这里读它在 DSH_HOME 下的落地文件，供「agent 菜单列」把群聊并进来。
        // seq / updatedAt 用来算未读：seq = events.jsonl 的消息行数，updatedAt = 文件 mtime。
        const groups = [];
        try {
          const dir = groupchatDir();
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            try {
              const groupDir = path.join(dir, entry.name);
              const raw = JSON.parse(await readFile(path.join(groupDir, 'group.json'), 'utf8'));
              const members = Array.isArray(raw.members) ? raw.members.length : Array.isArray(raw.characterIds) ? raw.characterIds.length : 0;
              let seq = 0;
              let updatedAt = 0;
              try {
                const events = await readFile(path.join(groupDir, 'events.jsonl'), 'utf8');
                seq = events.split('\n').reduce((count, line) => (line.trim() ? count + 1 : count), 0);
              } catch { /* 还没消息 */ }
              try {
                const info = await stat(path.join(groupDir, 'group.json'));
                updatedAt = Math.round(info.mtimeMs);
              } catch { /* 忽略 */ }
              groups.push({
                id: entry.name,
                name: typeof raw.name === 'string' && raw.name ? raw.name : entry.name,
                brief: typeof raw.brief === 'string' ? raw.brief : '',
                members,
                seq,
                updatedAt,
              });
            } catch { /* 跳过损坏或半写入的群文件 */ }
          }
        } catch { /* 插件未安装，或还没建过群 */ }
        groups.sort((a, b) => b.updatedAt - a.updatedAt);
        return send(res, 200, { groups });
      }
      return send(res, 404, { error: 'not-found', path: pathname });
    } catch (error) {
      return send(res, 400, { error: String(error && error.message ? error.message : error) });
    }
  };
}
