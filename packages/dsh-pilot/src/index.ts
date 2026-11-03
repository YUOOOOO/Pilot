// Pilot 宿主半：持有本机数据、暴露 HTTP 面与 Agent 工具。
// 数据落在 $DSH_HOME/storages/dsh-pilot/pilot.json，与 dsh-dev-workbench 的目录约定一致。
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { PilotStore } from './host/store.mjs';
import { createPilotHandler } from './host/routes.mjs';
import { registerPilotTools } from './host/tools';
import { product } from './product';

interface MutateDoc {
  settings: Record<string, unknown>;
  tasks: Record<string, Record<string, unknown>>;
}

interface PilotHostService {
  readonly file: string;
  snapshot(): MutateDoc & { version: number; updatedAt: string };
  mutate(fn: (draft: MutateDoc) => unknown): Promise<unknown>;
}

interface HostContext {
  provide(name: string, value: unknown): unknown;
  effect(setup: () => () => void, label?: string): unknown;
  get?(name: string): unknown;
  [key: string]: unknown;
}

/** Resolve a service via ctx.get (no inject requirement), retrying briefly while the composition loads. */
function withService(ctx: HostContext, name: string, run: (service: any) => void, tries = 20): void {
  const service = ctx.get ? ctx.get(name) : undefined;
  if (service) {
    run(service);
    return;
  }
  if (tries <= 0) {
    console.warn(`[pilot] service "${name}" is unavailable; that surface stays off`);
    return;
  }
  setTimeout(() => withService(ctx, name, run, tries - 1), 100);
}

export function apply(ctx: HostContext): void {
  ctx.provide('pilotProduct', product);

  const file = join(resolveDshHome(undefined, process.env), 'storages', 'dsh-pilot', 'pilot.json');
  const store = new PilotStore(file);
  const ready: Promise<PilotStore> = store.open().then(opened => {
    console.log(`[pilot] store ready: ${opened.file}${opened.recoveredFrom ? ` (recovered, backup ${opened.recoveredFrom})` : ''}`);
    return opened;
  }).catch(error => {
    console.error('[pilot] store failed to open:', error);
    throw error;
  });

  const service: PilotHostService = {
    file,
    snapshot: () => store.snapshot(),
    mutate: fn => ready.then(() => store.mutate(fn)),
  };
  ctx.provide('pilotStore', service);
  ctx.effect(() => () => { void store.close(); }, 'pilot: store lifecycle');

  withService(ctx, 'webServer', webServer => {
    ctx.effect(
      () => webServer.register({ kind: 'prefix', path: '/pilot', handler: createPilotHandler(store, () => ({ ...product, store: file })) }),
      'pilot: http surface',
    );
    console.log('[pilot] http surface mounted at /pilot');
  });

  withService(ctx, 'tools', tools => {
    ctx.effect(() => {
      const disposers = registerPilotTools({ tools }, service as never);
      return () => { for (const dispose of disposers) dispose(); };
    }, 'pilot: agent tools');
    console.log('[pilot] agent tools registered: pilot_task_add/list/update/delete');
  });
}
