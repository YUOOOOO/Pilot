/** @jsxRuntime classic */
import * as React from 'react';
import { desktop, useDesktopInfo } from '../core/desktop';
import { product } from '../product';
import { pageById, pageEntries } from './registry';
import { go, togglePalette, useWorkbench } from './store';
import { CommandPalette } from './palette';
import '../styles/shell.css';

/** 渲染在 main 座位里的工作台外壳：页面切换、快捷键、命令面板、状态行与页脚。 */
export interface PageApi {
  /** 回到宿主的会话面板 */
  openConversation(): void;
}

const PageContext = React.createContext<PageApi>({ openConversation: () => {} });
export function usePageApi(): PageApi {
  return React.useContext(PageContext);
}

export function WorkbenchApp({ openConversation }: PageApi) {
  const state = useWorkbench();
  const info = useDesktopInfo();
  const bridge = desktop();
  const order = pageEntries();
  const entry = pageById(state.page) ?? order[0];
  const palette = state.palette;

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
        return;
      }
      if (meta && /^[1-9]$/.test(event.key)) {
        const next = order[Number(event.key) - 1];
        if (next) { event.preventDefault(); go(next.id); }
        return;
      }
      if (event.key === 'Escape' && palette) {
        event.preventDefault();
        togglePalette(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, palette]);

  const Page = entry?.component;
  return <main className="pilot-home" data-accent={state.prefs.accent} aria-labelledby="pilot-page-title">
    <PageContext.Provider value={{ openConversation }}>
      <div className="pilot-view">
        {Page ? <Page /> : <p className="pilot-view-sub">页面未注册：{state.page}</p>}
        <p className="pilot-status" role="status" aria-live="polite" aria-atomic="true">{state.status}</p>
      </div>
      <CommandPalette />
    </PageContext.Provider>
  </main>;
}
