// Pilot 宿主 HTTP 面：挂在 ctx.webServer 的 `/pilot` 前缀下，给浏览器半读写这份文档。
// 只做 JSON、只接受本机同源调用（同源由宿主路由天然保证），不信任任何未校验字段。
const MAX_BODY = 256 * 1024;
const TASK_STATUSES = new Set(['todo', 'doing', 'done']);

function send(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
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

/**
 * Build the request handler for the `/pilot` prefix.
 * @param {import('./store.mjs').PilotStore} store
 * @param {() => object} info product metadata for GET /pilot/info
 */
export function createPilotHandler(store, info = () => ({})) {
  return async function pilotHandler(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname.replace(/^\/pilot\/?/, '');
    const segment = pathname.split('/').filter(Boolean);
    try {
      if (method === 'GET' && segment.length === 0) return send(res, 200, { ...store.snapshot(), product: info() });
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
      return send(res, 404, { error: 'not-found', path: pathname });
    } catch (error) {
      return send(res, 400, { error: String(error && error.message ? error.message : error) });
    }
  };
}
