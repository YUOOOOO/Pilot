// Pilot 鉴权：本机回环放行 + 密码会话 + 访问令牌，为「远程访问 / 多设备登录」打底。
//
// 现状（改造前）：/pilot/* 与插件自己的 /knowledge/* 都假定「只有本机同源浏览器能访问」，
// 没有任何凭据校验；一旦把 Host 绑到局域网或公网，任何人都能读写任务、设置与知识库。
// 这里先给 Pilot 自己的 HTTP 面补上三种模式：
//
//   loopback（默认）  只放行回环地址。等于把现在的隐含假设显式化，行为与改造前一致。
//   password          回环放行；其他来源必须带登录会话 Cookie 或 Bearer 令牌。
//   open              全部放行（显式选择，给测试/内网完全信任场景用）。
//
// 密码用 scrypt 加盐哈希；会话是无状态签名 Cookie（v1.<过期毫秒>.<HMAC>），进程重启后仍有效；
// 访问令牌用于脚本/命令行，轮换后旧令牌立即失效。所有比较都走 timingSafeEqual。
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const AUTH_VERSION = 1;
export const SESSION_COOKIE = 'pilot_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MODES = ['loopback', 'password', 'open'];
const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;

/** 判断一个 socket 地址是否是回环地址（含 IPv4 映射形式）。 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false;
  const text = address.toLowerCase();
  if (text === '::1' || text === '127.0.0.1') return true;
  if (text.startsWith('::ffff:')) return isLoopbackAddress(text.slice('::ffff:'.length));
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text);
}

/** 解析 Cookie 头为普通对象；重复键取第一个。 */
export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header === '') return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in out) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/** 生成 Set-Cookie 值。远程模式下由网关决定是否加 Secure。 */
export function serializeCookie(name, value, { maxAge, secure = false, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`);
  return parts.join('; ');
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function defaultDocument() {
  return {
    version: AUTH_VERSION,
    mode: 'loopback',
    password: null,
    accessToken: '',
    secret: '',
    updatedAt: new Date().toISOString(),
  };
}

function normalize(input) {
  const base = defaultDocument();
  if (!input || typeof input !== 'object') return base;
  const mode = MODES.includes(input.mode) ? input.mode : base.mode;
  const password = input.password && typeof input.password === 'object' && input.password.hash
    ? {
      algo: 'scrypt',
      n: Number.isInteger(input.password.n) ? input.password.n : SCRYPT_N,
      salt: String(input.password.salt || ''),
      hash: String(input.password.hash || ''),
    }
    : null;
  return {
    version: AUTH_VERSION,
    mode,
    password,
    accessToken: typeof input.accessToken === 'string' ? input.accessToken : '',
    secret: typeof input.secret === 'string' ? input.secret : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
  };
}

/**
 * 鉴权状态机。`open()` 之后同步方法可用；所有写操作串行落盘（先写临时文件再 rename）。
 */
export class PilotAuth {
  /**
   * @param {string} file auth.json 的绝对路径
   * @param {{ mode?: 'loopback'|'password'|'open' }} [options] 配置文件缺失时的初始模式
   */
  constructor(file, options = {}) {
    this.file = file;
    this.options = options;
    this.doc = defaultDocument();
    if (options.mode && MODES.includes(options.mode)) this.doc.mode = options.mode;
    this.failures = new Map();
    this.chain = Promise.resolve();
  }

  async open() {
    await mkdir(dirname(this.file), { recursive: true });
    let loaded = false;
    try {
      this.doc = normalize(JSON.parse(await readFile(this.file, 'utf8')));
      loaded = true;
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        // 坏文件不阻塞启动：备份后重置，和 PilotStore 的策略一致。
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => {});
      }
    }
    if (!loaded) {
      if (!this.doc.secret) this.doc.secret = randomBytes(32).toString('hex');
      await this.flush();
    }
    return this;
  }

  get mode() {
    return this.doc.mode;
  }

  get hasPassword() {
    return Boolean(this.doc.password);
  }

  /** 访问令牌只在本机可见；远程模式用来给脚本签发 Bearer。 */
  get accessToken() {
    return this.doc.accessToken;
  }

  async flush() {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.doc, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }

  /** 串行写：读-改-写不会互相覆盖。 */
  mutate(change) {
    const run = this.chain.then(async () => {
      const next = JSON.parse(JSON.stringify(this.doc));
      change(next);
      this.doc = normalize(next);
      this.doc.updatedAt = new Date().toISOString();
      if (!this.doc.secret) this.doc.secret = randomBytes(32).toString('hex');
      await this.flush();
      return this.doc;
    });
    this.chain = run.then(() => {}, () => {});
    return run;
  }

  // ── 密码 ─────────────────────────────────────────────────────────────
  hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N }).toString('hex');
    return { algo: 'scrypt', n: SCRYPT_N, salt, hash };
  }

  verifyPassword(password) {
    const stored = this.doc.password;
    if (!stored || !stored.salt || !stored.hash) return false;
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = scryptSync(String(password), stored.salt, expected.length, { N: stored.n || SCRYPT_N });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** 登录失败按来源计数；连续 5 次后锁 5 分钟，避免在线爆破。 */
  lockedFor(key) {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    if (Date.now() >= entry.until) { this.failures.delete(key); return 0; }
    return entry.until - Date.now();
  }

  recordFailure(key) {
    const entry = this.failures.get(key) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.count = 0;
      entry.until = Date.now() + LOCK_MS;
    }
    this.failures.set(key, entry);
  }

  clearFailures(key) {
    this.failures.delete(key);
  }

  // ── 会话 ─────────────────────────────────────────────────────────────
  sign(value) {
    if (!this.doc.secret) this.doc.secret = randomBytes(32).toString('hex');
    return createHmac('sha256', this.doc.secret).update(value).digest('base64url');
  }

  createSession(now = Date.now()) {
    const payload = `v1.${now + SESSION_TTL_MS}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verifySession(token, now = Date.now()) {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return false;
    const expires = Number(parts[1]);
    if (!Number.isFinite(expires) || expires <= now) return false;
    return safeEqualText(parts[2], this.sign(`v1.${parts[1]}`));
  }

  // ── 请求判定 ──────────────────────────────────────────────────────────
  /** 从请求里取凭据：Authorization: Bearer，其次 ?access_token=，最后 Cookie。 */
  credentialOf(req, url) {
    const header = req?.headers?.authorization;
    if (typeof header === 'string' && /^bearer\s+/i.test(header)) return { kind: 'bearer', value: header.replace(/^bearer\s+/i, '').trim() };
    const queryToken = url?.searchParams?.get('access_token');
    if (queryToken) return { kind: 'bearer', value: queryToken };
    const cookies = parseCookies(req?.headers?.cookie);
    if (cookies[SESSION_COOKIE]) return { kind: 'session', value: cookies[SESSION_COOKIE] };
    return null;
  }

  /**
   * 判定一个请求是否放行。
   * @returns {{ ok: true, via: string } | { ok: false, reason: string }}
   */
  authorize(req, url) {
    const loopback = isLoopbackAddress(req?.socket?.remoteAddress);
    if (this.doc.mode === 'open') return { ok: true, via: 'open' };
    if (this.doc.mode === 'loopback') {
      return loopback ? { ok: true, via: 'loopback' } : { ok: false, reason: 'remote-not-allowed' };
    }
    if (loopback) return { ok: true, via: 'loopback' };
    const credential = this.credentialOf(req, url);
    if (!credential) return { ok: false, reason: 'missing-credential' };
    if (credential.kind === 'bearer') {
      return this.doc.accessToken && safeEqualText(credential.value, this.doc.accessToken)
        ? { ok: true, via: 'token' }
        : { ok: false, reason: 'bad-token' };
    }
    return this.verifySession(credential.value) ? { ok: true, via: 'session' } : { ok: false, reason: 'bad-session' };
  }

  /** 对外可见的状态（不泄露哈希、令牌、会话）。 */
  state(req, url = new URL('http://127.0.0.1/')) {
    const decision = this.authorize(req, url);
    return {
      mode: this.doc.mode,
      hasPassword: this.hasPassword,
      hasToken: Boolean(this.doc.accessToken),
      loopback: isLoopbackAddress(req?.socket?.remoteAddress),
      authed: decision.ok,
      via: decision.ok ? decision.via : null,
    };
  }

  /**
   * Credential-only check: the gateway uses it to force a remote login (no loopback bypass).
   * @returns {{ ok: true, via: string } | { ok: false, reason: string }}
   */
  authorizeCredential(req, url) {
    const credential = this.credentialOf(req, url);
    if (!credential) return { ok: false, reason: 'missing-credential' };
    if (credential.kind === 'bearer') {
      return this.doc.accessToken && safeEqualText(credential.value, this.doc.accessToken)
        ? { ok: true, via: 'token' }
        : { ok: false, reason: 'bad-token' };
    }
    return this.verifySession(credential.value) ? { ok: true, via: 'session' } : { ok: false, reason: 'bad-session' };
  }

  async setMode(mode) {
    if (!MODES.includes(mode)) throw new Error('invalid mode');
    return this.mutate(draft => { draft.mode = mode; });
  }

  async setPassword(next) {
    const text = String(next ?? '');
    if (text.length < 8) throw new Error('password-too-short');
    if (text.length > 200) throw new Error('password-too-long');
    const password = this.hashPassword(text);
    return this.mutate(draft => { draft.password = password; });
  }

  async clearPassword() {
    return this.mutate(draft => { draft.password = null; });
  }

  async rotateToken() {
    const accessToken = `pilot_${randomBytes(24).toString('hex')}`;
    await this.mutate(draft => { draft.accessToken = accessToken; });
    return accessToken;
  }
}

/** 显式开放模式：只给测试和「完全信任」的部署用。 */
export function openAuth() {
  const auth = new PilotAuth('memory', { mode: 'open' });
  auth.doc.mode = 'open';
  return auth;
}
