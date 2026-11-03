// 浏览器半访问宿主数据：同源 fetch `/pilot`，宿主不可用时全部退化为本地缓存。

export interface PilotHostTask {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotHostState {
  version: number;
  updatedAt: string;
  settings: Record<string, unknown>;
  tasks: Record<string, PilotHostTask>;
  product?: { name?: string; version?: string; engineVersion?: string; store?: string };
}

async function request(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      cache: 'no-store',
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/** Read the whole Pilot document from the host; `null` when the host surface is absent. */
export async function readHostState(): Promise<PilotHostState | null> {
  const response = await request('/pilot');
  if (!response) return null;
  try {
    return (await response.json()) as PilotHostState;
  } catch {
    return null;
  }
}

/** Merge settings into the host document. Resolves `true` only after the host acknowledged the write. */
export async function saveHostSettings(settings: Record<string, unknown>): Promise<boolean> {
  const response = await request('/pilot/settings', { method: 'PUT', body: JSON.stringify(settings) });
  return response !== null;
}

export async function saveHostTask(input: { title: string; status?: string; note?: string }): Promise<PilotHostTask | null> {
  const response = await request('/pilot/tasks', { method: 'POST', body: JSON.stringify(input) });
  if (!response) return null;
  try {
    const payload = (await response.json()) as { task?: PilotHostTask };
    return payload.task ?? null;
  } catch {
    return null;
  }
}
