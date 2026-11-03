// Pilot 宿主存储：一份原子写的 JSON 文档，落在 $DSH_HOME/storages/dsh-pilot/pilot.json。
// 与 dsh-dev-workbench 同样的策略：插件自己持有状态，写盘先写临时文件再 rename；
// 文档损坏就备份成 .corrupt-<时间戳> 并从默认文档重来，绝不让宿主因坏文件起不来。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DOCUMENT_VERSION = 1;

export function defaultDocument() {
  return {
    version: DOCUMENT_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {},
    tasks: {},
  };
}

function normalize(input) {
  const base = defaultDocument();
  if (!input || typeof input !== 'object') return base;
  const settings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings) ? { ...input.settings } : {};
  const tasks = {};
  const source = input.tasks && typeof input.tasks === 'object' && !Array.isArray(input.tasks) ? input.tasks : {};
  for (const [id, task] of Object.entries(source)) {
    if (!id || !task || typeof task !== 'object') continue;
    tasks[id] = {
      id,
      title: typeof task.title === 'string' ? task.title : '',
      status: task.status === 'done' ? 'done' : task.status === 'doing' ? 'doing' : 'todo',
      note: typeof task.note === 'string' ? task.note : '',
      createdAt: typeof task.createdAt === 'string' ? task.createdAt : base.updatedAt,
      updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : base.updatedAt,
    };
  }
  return {
    version: DOCUMENT_VERSION,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    settings,
    tasks,
  };
}

export class PilotStore {
  /**
   * @param {string} file absolute path of the JSON document
   */
  constructor(file) {
    this.file = file;
    this.doc = defaultDocument();
    this.chain = Promise.resolve();
    this.ready = false;
    this.recoveredFrom = null;
  }

  /** Create the directory, load (or seed) the document, and mark the store usable. */
  async open() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      this.doc = normalize(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        this.doc = defaultDocument();
        await this.flush();
      } else {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await rename(this.file, backup).catch(() => {});
        this.recoveredFrom = backup;
        this.doc = defaultDocument();
        await this.flush();
      }
    }
    this.ready = true;
    return this;
  }

  /** Detached copy of the current document. */
  snapshot() {
    return JSON.parse(JSON.stringify(this.doc));
  }

  /**
   * Serialized read-modify-write. The callback receives a detached copy and returns
   * the next document (or mutates the copy in place); durability happens before the
   * caller resolves, so a resolved promise always means "on disk".
   * @param {(doc: ReturnType<typeof defaultDocument>) => unknown} fn
   */
  mutate(fn) {
    const run = this.chain.then(async () => {
      const draft = this.snapshot();
      const result = fn(draft);
      this.doc = normalize(result && typeof result === 'object' ? result : draft);
      this.doc.updatedAt = new Date().toISOString();
      await this.flush();
      return this.snapshot();
    });
    this.chain = run.then(() => {}, () => {});
    return run;
  }

  async flush() {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.doc, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }

  async close() {
    await this.chain.catch(() => {});
    this.ready = false;
  }
}
