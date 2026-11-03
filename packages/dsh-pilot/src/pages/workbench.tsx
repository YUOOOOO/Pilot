/** @jsxRuntime classic */
import * as React from 'react';
import { desktop } from '../core/desktop';
import { workspaceApi } from '../agent-menu';
import { registerPage } from '../workbench/registry';
import { runAction, toggleSettings, useWorkbench } from '../workbench/store';
import { usePageApi } from '../workbench/shell';

// ── 今日 Token ─────────────────────────────────────────────────────
// 宿主的 tokenUsage 是「会话累计」值，这里近似为「今天活动过的会话」之和；
// 跨天会话会把它的历史总量也算进来，卡片上给出说明。
function tokensOfSession(summary: { projectionValues?: { tokenUsage?: unknown } } | undefined): number {
  const usage = summary?.projectionValues?.tokenUsage as
    | { total?: number; inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number }
    | undefined;
  if (!usage || typeof usage !== 'object') return 0;
  const total = usage.total ?? (usage.inputTokens ?? usage.promptTokens ?? 0) + (usage.outputTokens ?? usage.completionTokens ?? 0);
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0;
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function useTodayTokens(): number {
  const store = workspaceApi()?.sessions;
  const [state, setState] = React.useState(() => store?.getSnapshot() ?? {});
  React.useEffect(() => {
    if (!store) return;
    const unsubscribe = store.subscribe(() => setState(store.getSnapshot()));
    setState(store.getSnapshot());
    return unsubscribe;
  }, [store]);
  return React.useMemo(() => {
    const byId = (state as {
      byId?: Record<string, { updatedAt?: number; projectionValues?: { tokenUsage?: unknown } }>;
    }).byId ?? {};
    const since = startOfToday();
    let total = 0;
    for (const summary of Object.values(byId)) {
      if ((summary.updatedAt ?? 0) < since) continue;
      total += tokensOfSession(summary);
    }
    return total;
  }, [state]);
}

/** 紧凑计数：517 / 12.2K / 517K / 1.2M（与宿主一致）。 */
function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1)}K`;
  if (value < 1000000) return `${Math.round(value / 1000)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
}

function WorkbenchPage() {
  const { openConversation } = usePageApi();
  const { busy } = useWorkbench();
  const bridge = desktop();
  const todayTokens = useTodayTokens();
  const openSettings = () => toggleSettings(true);
  return <>
    <section className="pilot-token-card" aria-label="今日 Token 消耗">
      <div className="pilot-token-main">
        <span className="pilot-token-label">今日 Token 消耗</span>
        <span className="pilot-token-value" data-empty={todayTokens === 0 || undefined}>{todayTokens > 0 ? formatTokens(todayTokens) : '尚未消耗'}</span>
        <span className="pilot-token-hint">按今天活动过的会话累计；跨天会话会包含它的历史总量。</span>
      </div>
      {todayTokens === 0 && (
        <button type="button" className="pilot-pill is-small" onClick={openSettings}>打开配置页</button>
      )}
    </section>
  </>;
}

registerPage({
  id: 'workbench',
  meta: { title: '工作台', hint: '概览、上手步骤与快捷入口', icon: 'home', group: '工作' },
  component: WorkbenchPage,
});

export { WorkbenchPage };
