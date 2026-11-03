// 本机偏好：只存 localStorage，不含任何业务数据；宿主侧的模型/语言/主题仍归宿主设置。
export interface PilotPrefs {
  /** 启动后默认进入的面：'workbench' = 工作台，'agent' = 会话与项目 */
  defaultPage: string;
  /** 侧轨导航行是否显示 ⌘N 快捷键提示 */
  showKeys: boolean;
  /** 强调色 id，对应 ACCENTS 里的色板 */
  accent: string;
}

const STORAGE_KEY = 'pilot:prefs:v1';

/** 默认进入的两个去处：工作台 / 宿主的会话与项目。 */
export const DEFAULT_PAGES = [
  { id: 'workbench', label: '工作台' },
  { id: 'agent', label: '会话与项目' },
] as const;

/** 把任意存量值收敛到两个合法去处，避免旧版本写下的 'tools' 等页面渗进来。 */
export function normalizeDefaultPage(value: unknown): string {
  return value === 'agent' ? 'agent' : 'workbench';
}

/** 可选强调色：id 落进 localStorage，实际色值在 shell.css 的 [data-accent] 规则里。 */
export const ACCENTS = [
  { id: 'teal', label: '青绿', swatch: '#0f766e' },
  { id: 'blue', label: '蓝', swatch: '#2563eb' },
  { id: 'violet', label: '紫', swatch: '#7c3aed' },
  { id: 'amber', label: '琥珀', swatch: '#d97706' },
  { id: 'rose', label: '玫红', swatch: '#e11d48' },
  { id: 'graphite', label: '石墨', swatch: '#374151' },
] as const;

export function isAccentId(value: unknown): value is string {
  return typeof value === 'string' && ACCENTS.some(accent => accent.id === value);
}

export const DEFAULT_PREFS: PilotPrefs = {
  defaultPage: 'workbench',
  showKeys: true,
  accent: 'teal',
};

export function loadPrefs(): PilotPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<PilotPrefs>;
    return {
      defaultPage: normalizeDefaultPage(parsed.defaultPage),
      showKeys: parsed.showKeys !== false,
      accent: isAccentId(parsed.accent) ? parsed.accent : DEFAULT_PREFS.accent,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: PilotPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 隐私模式或配额满：偏好退回内存态，不影响页面 */
  }
}

export function clearPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
