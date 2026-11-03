// 页面注册表 —— 沿用 dsh-dev-workbench 的骨架：每个页面模块自报 meta 并注册自己，
// 导航、⌘1..N、⌘K 命令面板都从这张表读，不再各处硬编码页面清单。
import type * as React from 'react';
import type { IconKind } from '../sidebar';

export interface PageMeta {
  /** 导航行与命令面板里的标题 */
  title: string;
  /** 一句话说明，命令面板与 hover 提示用 */
  hint: string;
  icon: IconKind;
  /** 侧轨分组；未声明则落进「工作」 */
  group?: string;
}

export interface PageEntry {
  id: string;
  meta: PageMeta;
  component: React.ComponentType<unknown>;
}

/** 分组顺序固定，页面按注册顺序排在各自分组里 */
export const NAV_GROUPS = ['工作', '工具', '系统'] as const;

const registry = new Map<string, PageEntry>();

export function registerPage(entry: PageEntry): () => void {
  registry.set(entry.id, entry);
  return () => {
    if (registry.get(entry.id) === entry) registry.delete(entry.id);
  };
}

export function pageEntries(): PageEntry[] {
  return [...registry.values()];
}

export function pageById(id: string): PageEntry | undefined {
  return registry.get(id);
}

export function pageOrder(): string[] {
  return pageEntries().map(entry => entry.id);
}

/** 按分组折叠成 [{label, entries}]，供侧轨渲染；空分组不出现 */
export function navGroups(): { label: string; entries: PageEntry[] }[] {
  const entries = pageEntries();
  const groups = NAV_GROUPS.map(label => ({
    label,
    entries: entries.filter(entry => (entry.meta.group ?? '工作') === label),
  }));
  const extra = entries.filter(entry => !NAV_GROUPS.includes((entry.meta.group ?? '工作') as typeof NAV_GROUPS[number]));
  if (extra.length) groups.push({ label: '其他', entries: extra });
  return groups.filter(group => group.entries.length > 0);
}
