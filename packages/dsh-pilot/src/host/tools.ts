// Pilot 的 Agent 工具：让模型能把自己的待办与设置写进 Pilot 的宿主存储。
// 报表形状对齐 dsh-tool-todo：parameters 是逐属性 spec，output.schema 是规范值，render 出文本块。
import { defineTool } from '@deepseek-ai/dsh-tools';

interface TaskRecord {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreLike {
  snapshot(): { tasks: Record<string, TaskRecord>; settings: Record<string, unknown> };
  mutate(fn: (draft: any) => unknown): Promise<{ tasks: Record<string, TaskRecord> }>;
}

const STATUSES = ['todo', 'doing', 'done'] as const;

const taskShape = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    id: { type: 'string' as const, required: true },
    title: { type: 'string' as const, required: true },
    status: { type: 'string' as const, required: true, enum: [...STATUSES] },
    note: { type: 'string' as const, required: true },
    updatedAt: { type: 'string' as const, required: true },
  },
};

function counts(tasks: TaskRecord[]) {
  return {
    todo: tasks.filter(task => task.status === 'todo').length,
    doing: tasks.filter(task => task.status === 'doing').length,
    done: tasks.filter(task => task.status === 'done').length,
  };
}

function newId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Register Pilot's tools on the host tool registry.
 * @param ctx cordis context with the `tools` service
 * @param store opened Pilot store
 * @returns disposers, one per tool
 */
export function registerPilotTools(ctx: { tools: { register(definition: unknown): () => void } }, store: StoreLike): (() => void)[] {
  const list = () => Object.values(store.snapshot().tasks);

  const add = defineTool({
    name: 'pilot_task_add',
    description: 'Add one task to the Pilot workbench, persisted on this machine. Use it when the user asks to remember a piece of work.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short imperative title.' },
      status: { type: 'string', enum: [...STATUSES], description: 'todo (default) | doing | done.' },
      note: { type: 'string', description: 'Optional one-line context.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { task: taskShape, counts: { type: 'object', additionalProperties: false, required: true, properties: { todo: { type: 'integer', required: true }, doing: { type: 'integer', required: true }, done: { type: 'integer', required: true } } } } },
      render: (_args, value) => [{ type: 'text', text: `Added Pilot task "${value.task.title}" (${value.task.status}). ${value.counts.todo} todo, ${value.counts.doing} doing, ${value.counts.done} done.` }],
    },
    execute: async args => {
      const title = String(args.title ?? '').trim().slice(0, 200);
      if (!title) throw new Error('title is required');
      const status = STATUSES.includes(args.status as 'todo') ? (args.status as 'todo') : 'todo';
      const id = newId();
      const now = new Date().toISOString();
      await store.mutate(draft => {
        draft.tasks[id] = { id, title, status, note: String(args.note ?? '').slice(0, 2000), createdAt: now, updatedAt: now };
      });
      return { task: store.snapshot().tasks[id], counts: counts(list()) };
    },
  });

  const listTool = defineTool({
    name: 'pilot_task_list',
    description: 'List the tasks stored in the Pilot workbench on this machine.',
    parameters: {
      status: { type: 'string', enum: [...STATUSES], description: 'Filter by status; omit for all.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { tasks: { type: 'array', required: true, items: taskShape }, counts: { type: 'object', additionalProperties: false, required: true, properties: { todo: { type: 'integer', required: true }, doing: { type: 'integer', required: true }, done: { type: 'integer', required: true } } } } },
      render: (_args, value) => [{ type: 'text', text: value.tasks.length === 0 ? 'No Pilot tasks stored.' : value.tasks.map(task => `- [${task.status}] ${task.title}${task.note ? ` — ${task.note}` : ''} (${task.id})`).join('\n') }],
    },
    execute: async args => {
      const all = list();
      const tasks = args.status ? all.filter(task => task.status === args.status) : all;
      return { tasks, counts: counts(all) };
    },
  });

  const update = defineTool({
    name: 'pilot_task_update',
    description: 'Update one Pilot task by id: retitle, change status, or replace the note.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id returned by pilot_task_add / pilot_task_list.' },
      title: { type: 'string', description: 'New title.' },
      status: { type: 'string', enum: [...STATUSES], description: 'New status.' },
      note: { type: 'string', description: 'New note (empty string clears it).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { task: taskShape, counts: { type: 'object', additionalProperties: false, required: true, properties: { todo: { type: 'integer', required: true }, doing: { type: 'integer', required: true }, done: { type: 'integer', required: true } } } } },
      render: (_args, value) => [{ type: 'text', text: `Updated "${value.task.title}" to ${value.task.status}.` }],
    },
    execute: async args => {
      const id = String(args.id ?? '');
      if (!store.snapshot().tasks[id]) throw new Error(`no Pilot task with id ${id}`);
      await store.mutate(draft => {
        const task = draft.tasks[id];
        if (typeof args.title === 'string' && args.title.trim()) task.title = args.title.trim().slice(0, 200);
        if (STATUSES.includes(args.status as 'todo')) task.status = args.status;
        if (typeof args.note === 'string') task.note = args.note.slice(0, 2000);
        task.updatedAt = new Date().toISOString();
      });
      return { task: store.snapshot().tasks[id], counts: counts(list()) };
    },
  });

  const remove = defineTool({
    name: 'pilot_task_delete',
    description: 'Delete one Pilot task by id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id to delete.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { deleted: { type: 'string', required: true }, counts: { type: 'object', additionalProperties: false, required: true, properties: { todo: { type: 'integer', required: true }, doing: { type: 'integer', required: true }, done: { type: 'integer', required: true } } } } },
      render: (_args, value) => [{ type: 'text', text: `Deleted Pilot task ${value.deleted}.` }],
    },
    execute: async args => {
      const id = String(args.id ?? '');
      if (!store.snapshot().tasks[id]) throw new Error(`no Pilot task with id ${id}`);
      await store.mutate(draft => { delete draft.tasks[id]; });
      return { deleted: id, counts: counts(list()) };
    },
  });

  return [add, listTool, update, remove].map(tool => ctx.tools.register(tool));
}
