/** @jsxRuntime classic */
import * as React from 'react';
import { readHostState, saveHostSettings } from '../core/host-api';
import { resetPrefs, setPrefs, toggleSettings, useWorkbench } from './store';
import { ACCENTS, DEFAULT_PAGES, isAccentId, normalizeDefaultPage, type PilotPrefs } from './prefs';
import { hostSections, subscribeSections, type SettingsSectionRow } from './slots';
import { Panel, Segmented, SettingsRow, Toggle } from './ui';

const PILOT_SECTION = { id: 'pilot', label: '本机偏好' } as const;

/** 宿主 settings.section 的实时清单；slot 变化（插件装载/卸载）时刷新 */
function useHostSections(): SettingsSectionRow[] {
  return React.useSyncExternalStore(subscribeSections, hostSections, hostSections);
}

/** Pilot 自己的偏好面板：设置页与设置弹窗共用同一份内容 */
export function PrefsPanels() {
  const { prefs } = useWorkbench();
  const [host, setHost] = React.useState<{ ready: boolean; file?: string; updatedAt?: string }>({ ready: false });
  const pageItems = DEFAULT_PAGES.map(page => ({ value: page.id, label: page.label }));

  // 宿主在线时以宿主文档为准：拉一次，把里面的偏好灌进本地快照（只灌一次）。
  const adopted = React.useRef(false);
  React.useEffect(() => {
    let live = true;
    void readHostState().then(state => {
      if (!live || !state) return;
      setHost({ ready: true, file: state.product?.store, updatedAt: state.updatedAt });
      if (adopted.current) return;
      adopted.current = true;
      if (!state.settings || Object.keys(state.settings).length === 0) return;
      setPrefs({
        defaultPage: normalizeDefaultPage(state.settings.defaultPage),
        showKeys: state.settings.showKeys !== false,
        accent: isAccentId(state.settings.accent) ? state.settings.accent : prefs.accent,
      });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<PilotPrefs>) => {
    setPrefs(patch);
    const next = { ...prefs, ...patch };
    void saveHostSettings(next as unknown as Record<string, unknown>).then(ok => {
      if (ok) setHost(current => ({ ...current, ready: true }));
    });
  };

  const restore = () => {
    resetPrefs();
    void saveHostSettings({} as Record<string, unknown>);
    setHost(current => ({ ...current, updatedAt: new Date().toISOString() }));
  };

  return <div className="pilot-settings">
    <Panel title="本机偏好" sub="改动立即保存：先落本地缓存，再推给宿主" actions={<button type="button" className="pilot-pill is-small" onClick={restore}>恢复默认</button>}>
      <SettingsRow
        title="默认页面"
        hint="下次启动停在工作台，还是直接进入会话与项目"
        control={<Segmented label="默认页面" items={pageItems} value={prefs.defaultPage} onChange={next => update({ defaultPage: normalizeDefaultPage(next) })} />}
      />
      <SettingsRow
        title="侧轨快捷键提示"
        hint="在页面列表右侧显示 ⌘1…⌘N"
        control={<Toggle label="侧轨快捷键提示" checked={prefs.showKeys} onChange={next => update({ showKeys: next })} />}
      />
      <SettingsRow
        title="强调色"
        hint="侧栏与主区的强调色，随选择立即生效"
        control={<div className="pilot-accent-swatches" role="radiogroup" aria-label="强调色">
          {ACCENTS.map(accent => <button
            key={accent.id}
            type="button"
            role="radio"
            aria-checked={prefs.accent === accent.id}
            aria-label={accent.label}
            title={accent.label}
            className={prefs.accent === accent.id ? 'pilot-accent-swatch is-on' : 'pilot-accent-swatch'}
            onClick={() => update({ accent: accent.id })}
          ><span className="pilot-accent-swatch-dot" style={{ backgroundColor: accent.swatch }} aria-hidden="true" /></button>)}
        </div>}
      />
    </Panel>
  </div>;
}

/**
 * Pilot 设置弹窗：左列 = Pilot 自己的偏好 + 宿主注册的 settings.section 分组，
 * 右列 = 选中分组的正文（宿主分组直接用 renderSlot 渲染，不再跳到宿主设置页）。
 */
export function SettingsDialog({ renderSlot }: { renderSlot: (name: string, props: object, options?: object) => React.ReactNode }) {
  const { settingsOpen } = useWorkbench();
  const sections = useHostSections();
  const [active, setActive] = React.useState<string>(PILOT_SECTION.id);
  const close = React.useCallback(() => toggleSettings(false), []);

  React.useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, close]);

  if (!settingsOpen) return null;
  const hostActive = sections.some(section => section.id === active);
  return <div className="pilot-settings-mask" role="presentation" onClick={close}>
    <div className="pilot-settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onClick={event => event.stopPropagation()}>
      <header className="pilot-settings-head">
        <h2>设置</h2>
        <button type="button" className="pilot-icon-button" aria-label="关闭设置" title="关闭设置" onClick={close}>✕</button>
      </header>
      <div className="pilot-settings-body">
        <nav className="pilot-settings-nav" aria-label="设置分组">
          {sections.map(section => <button
            key={section.id}
            type="button"
            className="pilot-settings-navitem"
            aria-current={active === section.id ? 'page' : undefined}
            onClick={() => setActive(section.id)}
          >{section.label}</button>)}
          <button
            type="button"
            className="pilot-settings-navitem"
            aria-current={active === PILOT_SECTION.id ? 'page' : undefined}
            onClick={() => setActive(PILOT_SECTION.id)}
          >{PILOT_SECTION.label}</button>
        </nav>
        <div className="pilot-settings-content">
          {hostActive
            ? renderSlot('settings.section', { close }, { only: active })
            : active === PILOT_SECTION.id
              ? <PrefsPanels />
              : <p className="pilot-settings-empty">该分组已不可用。</p>}
        </div>
      </div>
    </div>
  </div>;
}
