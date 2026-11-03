/** @jsxRuntime classic */
import * as React from 'react';
import { registerPage } from '../workbench/registry';
import { PrefsPanels } from '../workbench/settings-dialog';

// 菜单列里的「偏好」页面：内容与齿轮弹窗里的「本机偏好」分组共用同一份面板。
function SettingsPage() {
  return <>
    <header className="pilot-view-head">
      <div className="pilot-view-head-text">
        <span className="pilot-view-eyebrow">Pilot · 偏好</span>
        <h1 id="pilot-page-title" className="pilot-view-title">偏好与<em>集成</em>。</h1>
        <p className="pilot-view-sub">同样的内容也在左下角齿轮的「设置」弹窗里；宿主的分组（通用、模型、插件…）已并入那个弹窗。</p>
      </div>
    </header>
    <PrefsPanels />
  </>;
}

registerPage({
  id: 'prefs',
  meta: { title: '偏好', hint: '本机偏好、宿主存储与本地数据', icon: 'settings', group: '系统' },
  component: SettingsPage,
});

export { SettingsPage };
