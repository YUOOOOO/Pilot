// 宿主桌面桥：只有 Electron 外壳注入 window.pilotDesktop，网页版下为 undefined。
import * as React from 'react';

export interface DesktopInfo { name?: string; version?: string; platform?: string }
export interface DesktopBridge {
  getInfo?: () => Promise<DesktopInfo>;
  selectDirectory?: () => Promise<string | null>;
  openLogs?: () => Promise<unknown>;
  checkForUpdates?: () => Promise<{ configured?: boolean } | void>;
}
declare global { interface Window { pilotDesktop?: DesktopBridge } }

export function desktop(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.pilotDesktop;
}

export function useDesktopInfo(): DesktopInfo | null {
  const [info, setInfo] = React.useState<DesktopInfo | null>(null);
  React.useEffect(() => {
    let live = true;
    const bridge = desktop();
    if (bridge?.getInfo) {
      Promise.resolve().then(() => bridge.getInfo!()).then(value => {
        if (live && value && typeof value === 'object') setInfo(value);
      }).catch(() => { /* 外壳不可用时仍显示产品元信息 */ });
    }
    return () => { live = false; };
  }, []);
  return info;
}
