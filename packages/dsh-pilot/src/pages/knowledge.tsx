/** @jsxRuntime classic */
import * as React from 'react';
import { IconBook } from '../../../dsh-knowledge/src/ui/client/icons';
import { KnowledgePanel } from '../../../dsh-knowledge/src/ui/client/KnowledgeSection';
import { createKnowledgePanelStore } from '../../../dsh-knowledge/src/ui/client/panel-store';
import { kbApi, kbT } from '../workbench/knowledge-shared';
import { registerPage } from '../workbench/registry';

// 面板组件原本挂在 `shell.overlay`（整窗 fixed 浮层）。这里自己持有一个常开的 store，
// 把它当普通页面渲染在主内容区：样式由 shell.css 的 `.pilot-kb-page` 改成贴合的绝对定位。
// close 做成空操作——页面内不提供关闭，切到别的页面由卸载副作用负责（否则点了它的关闭会白屏）。
const base = createKnowledgePanelStore();
const store = { ...base, close: () => {} };

function KnowledgePage() {
  React.useEffect(() => {
    store.open();
    return () => { store.close(); };
  }, []);
  return <div className="pilot-kb-page" aria-label="知识库">
    <KnowledgePanel store={store} api={kbApi} t={kbT} />
  </div>;
}

registerPage({
  id: 'knowledge',
  meta: { title: '知识库', hint: '资料入库、检索与预览', icon: 'library', group: '工作' },
  component: KnowledgePage,
});

export { KnowledgePage, IconBook };
