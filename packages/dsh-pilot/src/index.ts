import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { PilotStore } from './host/store.mjs';
import { PilotAuth } from './host/auth.mjs';
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

  const home = resolveDshHome(undefined, process.env);
  const file = join(home, 'storages', 'dsh-pilot', 'pilot.json');
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

  // 鉴权：/pilot/* 不再默认「反正只有本机能访问」，改为显式判定（默认仅回环放行）。
  const authFile = join(home, 'storages', 'dsh-pilot', 'auth.json');
  const auth = new PilotAuth(authFile);
  const authReady = auth.open().then(opened => {
    console.log(`[pilot] auth ready: mode=${opened.mode} file=${authFile}`);
    return opened;
  }).catch(error => {
    console.error('[pilot] auth failed to open, falling back to loopback-only:', error);
    return auth;
  });

  withService(ctx, 'webServer', webServer => {
    const route = createPilotHandler(store, () => ({ ...product, store: file }), auth);
    const handler = async (req: any, res: any) => {
      await authReady;
      return route(req, res);
    };
    ctx.effect(
      () => webServer.register({ kind: 'prefix', path: '/pilot', handler }),
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
