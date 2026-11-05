/** @jsxRuntime classic */
import * as React from 'react';
import type { BaseSummary, KnowledgeConfig } from '../../../dsh-knowledge/src/ui/client/api';
import { GlobalConfigPanel } from './global-config';
import { kbApi, kbT } from './knowledge-shared';
import { hostSections } from './slots';
import { Panel, SettingsRow, Toggle } from './ui';

type ToggleState = { enabled: boolean; enabledBaseIds: string[] };
type Loaded = { config: KnowledgeConfig; bases: BaseSummary[]; toggle: ToggleState };
type State = { status: 'loading' } | { status: 'missing' } | ({ status: 'ready' } & Loaded);

/** 把后端返回值收成界面需要的形状，缺字段用兜底值，避免半旧版本渲染崩 */
function normalize(config: KnowledgeConfig): KnowledgeConfig {
  return {
    ...config,
    embeddingProvider: config.embeddingProvider ?? 'none',
    embeddingBaseUrl: config.embeddingBaseUrl ?? '',
    embeddingModel: config.embeddingModel ?? '',
    embeddingApiKey: config.embeddingApiKey ?? '',
    chunkSize: Number.isFinite(config.chunkSize) ? config.chunkSize : 1024,
    chunkOverlap: Number.isFinite(config.chunkOverlap) ? config.chunkOverlap : 200,
    topK: Number.isFinite(config.topK) ? config.topK : 6,
    searchMode: config.searchMode ?? 'auto',
    similarityThreshold: Number.isFinite(config.similarityThreshold) ? config.similarityThreshold : 0,
    autoRetrieve: config.autoRetrieve !== false,
    autoRetrieveWeight: Number.isFinite(config.autoRetrieveWeight) ? config.autoRetrieveWeight : 3,
  };
}

/**
 * 设置弹窗里的「知识库」分组。
 * 全局配置直接用插件同源表单（GlobalConfigPanel），每库覆盖用它的 RagConfigPanel，
 * 插件注册的「本地模型」分组也并进来一起展示，这样设置里只有「知识库」一个入口。
 */
export function KnowledgePanels({ renderSlot }: { renderSlot?: (name: string, props: object, options?: object) => React.ReactNode }) {
  const [state, setState] = React.useState<State>({ status: 'loading' });
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const live = React.useRef(true);

  const reload = React.useCallback(async () => {
    try {
      const [config, bases, toggle] = await Promise.all([kbApi.getConfig(), kbApi.listBases(), kbApi.getKnowledgeToggle()]);
      if (!live.current) return;
      setState({ status: 'ready', config: normalize(config), bases, toggle });
    } catch {
      if (live.current) setState({ status: 'missing' });
    }
  }, []);

  React.useEffect(() => {
    live.current = true;
    void reload();
    return () => { live.current = false; };
  }, [reload]);

  const setEnabled = React.useCallback(async (enabled: boolean) => {
    setBusy(true);
    try {
      const toggle = await kbApi.setKnowledgeToggle({ enabled });
      if (!live.current) return;
      setState(prev => prev.status === 'ready' ? { ...prev, toggle } : prev);
      setNote(enabled ? '已启用知识库' : '已停用知识库');
    } catch (error) {
      if (!live.current) return;
      setNote(error instanceof Error ? error.message : '切换失败');
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  const reindex = React.useCallback(async (baseId: string, name: string) => {
    setBusy(true);
    setNote(`正在重建「${name}」索引…`);
    try {
      await kbApi.startReindexBase(baseId);
      if (!live.current) return;
      setNote(`「${name}」已开始重建索引`);
    } catch (error) {
      if (!live.current) return;
      setNote(error instanceof Error ? error.message : '重建失败');
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  if (state.status === 'loading') return <div className="pilot-settings"><p className="pilot-settings-empty">正在读取知识库配置…</p></div>;
  if (state.status === 'missing') {
    return <div className="pilot-settings">
      <Panel title="知识库" sub="宿主没有提供知识库接口">
        <p className="pilot-settings-empty">知识库插件当前不可用。完全退出 Pilot 再启动会重新装载插件。</p>
      </Panel>
    </div>;
  }

  const { config, bases, toggle } = state;
  const hasLocalModels = hostSections().some(section => section.id === 'local-models');

  return <div className="pilot-settings">
    <Panel
      title="知识库"
      sub="与知识库面板里的配置同源：字段一致，保存后立即生效"
      actions={<>
        <span className="pilot-settings-note" role="status">{busy ? '处理中…' : note}</span>
        <Toggle label="启用知识库" checked={toggle.enabled} onChange={next => void setEnabled(next)} />
      </>}
    >
      <div className="pilot-kb-rag">
        <GlobalConfigPanel
          config={config}
          api={kbApi}
          t={kbT}
          busy={busy}
          onSaved={() => { void reload(); setNote('已保存'); }}
        />
      </div>
    </Panel>

    <Panel title="知识库" sub={`${bases.length} 个库`} actions={<span className="pilot-settings-note">{toggle.enabled ? '已启用' : '已停用'}</span>}>
      {bases.length === 0
        ? <p className="pilot-settings-empty">还没有知识库。可以在侧栏的「知识库」面板里新建并导入文件。</p>
        : bases.map(base => <SettingsRow
          key={base.id}
          title={base.name}
          hint={`${base.documentCount} 篇文档 · ${base.chunkCount} 个片段 · ${base.tokenCount.toLocaleString()} tokens`}
          control={<button type="button" className="pilot-pill is-small" disabled={busy} onClick={() => void reindex(base.id, base.name)}>重建索引</button>}
        />)}
    </Panel>

    {/* 插件自己注册的「本地模型」分组：并进这里，左栏不再单列 */}
    {hasLocalModels && <Panel title="本地模型" sub="向量化与重排模型的下载、健康检查与缓存目录">
      <div className="pilot-kb-models">
        {renderSlot?.('settings.section', { close: () => {} }, { only: 'local-models' })}
      </div>
    </Panel>}
  </div>;
}
