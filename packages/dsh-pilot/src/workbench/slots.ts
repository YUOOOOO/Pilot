// 运行时拿到的 slots 能力：让设置弹窗能自行枚举并渲染宿主的 settings.section 分组。
type Entry = { options: { id?: string; label?: unknown; order?: number } };

export interface SlotBridge {
  entriesOfSlot(name: string): Entry[];
  subscribe(name: string, listener: () => void): () => void;
}

let bridge: SlotBridge | null = null;

export function bindSlotBridge(next: SlotBridge): void {
  bridge = next;
}

export function slotBridge(): SlotBridge | null {
  return bridge;
}

/** label 可能是字面量，也可能是随语言切换的函数 */
function labelOf(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'function') {
    try {
      const text = (value as () => unknown)();
      if (typeof text === 'string' && text) return text;
    } catch {
      /* 忽略：回落到 fallback */
    }
  }
  return fallback;
}

export interface SettingsSectionRow {
  id: string;
  label: string;
  order: number;
}

/** 宿主注册到 settings.section 的分组，按 order 排序。引用稳定：内容不变时返回同一数组，
 *  否则 useSyncExternalStore 会因每次快照都是新引用而无限重渲染。 */
let cachedRows: SettingsSectionRow[] = [];
let cachedKey = '\u0000';

export function hostSections(): SettingsSectionRow[] {
  if (!bridge) {
    if (cachedRows.length === 0) return cachedRows;
    cachedRows = [];
    cachedKey = '';
    return cachedRows;
  }
  let rows: SettingsSectionRow[] = [];
  try {
    rows = bridge.entriesOfSlot('settings.section')
      .map(entry => ({
        id: String(entry.options.id ?? ''),
        label: labelOf(entry.options.label, String(entry.options.id ?? '')),
        order: typeof entry.options.order === 'number' ? entry.options.order : 0,
      }))
      .filter(row => row.id)
      .sort((a, b) => a.order - b.order);
  } catch {
    rows = [];
  }
  const key = rows.map(row => `${row.id}\u0000${row.label}\u0000${row.order}`).join('\u0001');
  if (key !== cachedKey) {
    cachedKey = key;
    cachedRows = rows;
  }
  return cachedRows;
}

export function subscribeSections(listener: () => void): () => void {
  if (!bridge) return () => {};
  try {
    return bridge.subscribe('settings.section', listener);
  } catch {
    return () => {};
  }
}
