// 工作台快照 store —— 单一快照 + 订阅；本机偏好也挂在这份快照上，改动即落 localStorage。
import * as React from 'react';
import { DEFAULT_PREFS, clearPrefs, loadPrefs, savePrefs, type PilotPrefs } from './prefs';

export interface WorkbenchSnapshot {
  /** 当前页面 id（注册表里的 key） */
  page: string;
  palette: boolean;
  /** 最近一次操作反馈，页面底部状态行显示 */
  status: string;
  busy: boolean;
  /** 设置弹窗是否打开（齿轮按钮与 ⌘, 共用） */
  settingsOpen: boolean;
  /** 菜单列是否正在显示宿主的会话/项目浏览器（agent 页） */
  agent: boolean;
  prefs: PilotPrefs;
}

const initialPrefs = loadPrefs();
// 启动落点由「默认页面」偏好决定：agent 时先亮会话与项目，工作台仍保留为兜底页。
const initialAgent = initialPrefs.defaultPage === 'agent';
let snapshot: WorkbenchSnapshot = {
  page: initialAgent ? 'workbench' : initialPrefs.defaultPage,
  palette: false,
  status: '',
  busy: false,
  settingsOpen: false,
  agent: initialAgent,
  prefs: initialPrefs,
};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function getSnapshot(): WorkbenchSnapshot {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function patch(next: Partial<WorkbenchSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

export function go(page: string): void {
  if (snapshot.page === page && !snapshot.palette) return;
  patch({ page, palette: false });
}

export function togglePalette(open = !snapshot.palette): void {
  patch({ palette: open });
}

export function toggleSettings(open = !snapshot.settingsOpen): void {
  patch({ settingsOpen: open });
}

/** 切换 menu 列内容：true = 宿主的会话/项目浏览器，false = Pilot 页面列表 */
export function setAgent(agent: boolean): void {
  if (snapshot.agent === agent) return;
  patch({ agent });
}

/** 改一项本机偏好：内存快照 + localStorage 同时更新 */
export function setPrefs(next: Partial<PilotPrefs>): void {
  const prefs = { ...snapshot.prefs, ...next };
  savePrefs(prefs);
  patch({ prefs });
}

/** 清掉本机偏好并回到默认页 */
export function resetPrefs(): void {
  clearPrefs();
  patch({ prefs: { ...DEFAULT_PREFS }, page: DEFAULT_PREFS.defaultPage, agent: false, status: '已清除本机偏好。' });
}

export function useWorkbench(): WorkbenchSnapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 跑一次 bridge 动作：统一 busy / status 落点，异常也走状态行而不是 console。 */
export async function runAction(action: () => Promise<string>): Promise<void> {
  if (snapshot.busy) return;
  patch({ busy: true, status: '正在处理…' });
  try {
    patch({ status: await action() });
  } catch (error) {
    patch({ status: `操作未完成：${error instanceof Error ? error.message : '请稍后重试。'}` });
  } finally {
    patch({ busy: false });
  }
}
