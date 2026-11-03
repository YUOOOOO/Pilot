/** @jsxRuntime classic */
import * as React from 'react';
import { desktop, useDesktopInfo } from '../core/desktop';
import { product } from '../product';
import { registerPage } from '../workbench/registry';
import { runAction, useWorkbench } from '../workbench/store';

function ToolsPage() {
  const { busy } = useWorkbench();
  const info = useDesktopInfo();
  const bridge = desktop();
  return <>
    <header className="pilot-view-head">
      <div className="pilot-view-head-text">
        <span className="pilot-view-eyebrow">Pilot · 桌面工具</span>
        <h1 id="pilot-page-title" className="pilot-view-title">本机<em>集成</em>。</h1>
        <p className="pilot-view-sub">{bridge ? '管理本机项目，查看运行日志与版本信息。' : '当前为网页版：通过侧栏管理工作区，在设置中调整模型与使用偏好。'}</p>
      </div>
      <div className="pilot-view-actions">
        {bridge?.openLogs && <button type="button" className="pilot-pill is-small" disabled={busy} onClick={() => void runAction(async () => { await bridge.openLogs!(); return '已请求打开日志目录。'; })}>打开日志目录</button>}
        {bridge?.checkForUpdates && <button type="button" className="pilot-pill is-small" disabled={busy} onClick={() => void runAction(async () => {
          const result = await bridge.checkForUpdates!();
          return result?.configured === false ? '当前尚未配置自动更新，请从 Pilot 的发布渠道获取新版本。' : '已请求检查更新，请查看桌面提示。';
        })}>检查更新</button>}
      </div>
    </header>
    <div className="pilot-rows">
      <div className="pilot-row"><span className="pilot-row-label">外壳</span><span className="pilot-row-value">{bridge ? '桌面版（Electron）' : '网页版'}</span></div>
      <div className="pilot-row"><span className="pilot-row-label">Pilot 版本</span><span className="pilot-row-value">{info?.version || product.version}</span></div>
      <div className="pilot-row"><span className="pilot-row-label">引擎</span><span className="pilot-row-value">DeepSeek Harness {product.engineVersion}</span></div>
      <div className="pilot-row"><span className="pilot-row-label">平台</span><span className="pilot-row-value">{info?.platform || '—'}</span></div>
    </div>
  </>;
}

registerPage({
  id: 'tools',
  meta: { title: '桌面工具', hint: '日志、更新与版本信息', icon: 'wrench', group: '工具' },
  component: ToolsPage,
});

export { ToolsPage };
