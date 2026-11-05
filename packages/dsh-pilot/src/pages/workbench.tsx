/** @jsxRuntime classic */
import * as React from 'react';
import { workspaceApi } from '../agent-menu';
import { registerPage } from '../workbench/registry';
import { toggleSettings } from '../workbench/store';
import { Panel } from '../workbench/ui';
import { COST_METER_INSTALL_COMMAND, costMeterAvailable, readCostState, type CostMeterState } from '../workbench/cost-meter';
import {
  budgetProgress, currencySymbol, daySummary, formatMoney, formatTokens, formatUsd, modelRows, peakTransition, peakWindowsLabel,
} from '../workbench/cost-format.mjs';

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
function formatTokenCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1)}K`;
  if (value < 1000000) return `${Math.round(value / 1000)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
}

/** 时钟：今天 14:30 */
function clockOf(atMs: number): string {
  return new Date(atMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── 费用：数据来自 dsh-cost-meter 的 remote.costMeter.getState() ─────
type CostStatus = 'loading' | 'ready' | 'missing' | 'error';

function useCostMeter(): { status: CostStatus; state: CostMeterState | null; reload(): void; busy: boolean } {
  const [status, setStatus] = React.useState<CostStatus>('loading');
  const [state, setState] = React.useState<CostMeterState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      const next = await readCostState();
      if (next !== null) {
        setState(next);
        setStatus('ready');
      } else {
        setStatus(costMeterAvailable() ? 'error' : 'missing');
      }
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
    // 账本本身按事件增量写入；30s 拉一次足够，切走页面即停
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return { status, state, reload: () => { void load(); }, busy };
}

function Stat({ label, value, meta, primary }: { label: string; value: string; meta?: string; primary?: boolean }) {
  return <div className={primary ? 'pilot-cost-stat is-primary' : 'pilot-cost-stat'}>
    <span className="pilot-cost-label">{label}</span>
    <span className="pilot-cost-value">{value}</span>
    {meta && <span className="pilot-cost-meta">{meta}</span>}
  </div>;
}

function CostPanel() {
  const { status, state, reload, busy } = useCostMeter();
  const now = state?.meta?.now !== undefined ? state.meta.now : Date.now();

  const actions = <button type="button" className="pilot-pill is-small" onClick={reload} disabled={busy}>
    {busy ? '读取中…' : '刷新'}
  </button>;

  if (status === 'loading') {
    return <Panel title="费用概览" sub="正在读取 dsh-cost-meter 的费用账本…" actions={actions}>
      <p className="pilot-cost-empty">首次读取会回放本机会话日志，通常几秒内完成。</p>
    </Panel>;
  }

  if (status === 'missing' || status === 'error') {
    const missing = status === 'missing';
    return <Panel title="费用概览" sub="费用页由 dsh-cost-meter 提供，数据留在本机" actions={actions}>
      <div className="pilot-cost-empty">
        <p>{missing
          ? '这个 PILOT 配置里还没有安装 dsh-cost-meter，费用卡片暂时没有数据。'
          : 'dsh-cost-meter 已加载，但这次没读到费用快照；稍后点「刷新」重试。'}</p>
        {missing && <p>安装后重启 Pilot 即可在这里看到今日花费：</p>}
        {missing && <pre className="pilot-cost-cmd">{COST_METER_INSTALL_COMMAND}</pre>}
      </div>
    </Panel>;
  }

  const config = state?.config ?? {};
  const today = daySummary(state?.today, config);
  const month = daySummary(state?.month, config);
  const total = daySummary(state?.total, config);
  const budget = budgetProgress(state, config);
  const rows = modelRows(state?.today, config);
  const peak = peakTransition(now, config);
  const balance = state?.balance;
  const balanceOk = balance?.status === 'ok' && typeof balance.totalBalance === 'number';
  const balanceText = balanceOk ? `${currencySymbol(balance?.currency)}${(balance?.totalBalance ?? 0).toFixed(2)}` : '未配置';

  return <Panel
    title="费用概览"
    sub="今日 / 本月 / 累计花费与峰谷时段，数据来自 dsh-cost-meter 的本机账本（金额按该插件的价目表估算）。"
    actions={actions}
  >
    <div className="pilot-cost-grid">
      <Stat
        primary
        label="今日花费"
        value={formatUsd(today.cost, config)}
        meta={today.calls > 0 ? `${today.calls} 次调用 · ${formatTokens(today.tokens)} tokens` : '今天还没有调用'}
      />
      <Stat label="本月" value={formatUsd(month.cost, config)} meta={`${month.calls} 次调用`} />
      <Stat label="累计" value={formatUsd(total.cost, config)} meta={`${total.calls} 次调用`} />
      <Stat
        label="账户余额"
        value={balanceText}
        meta={balanceOk ? (balance?.message || '来自官方余额接口') : (balance?.message || '在 dsh-cost-meter 设置里配置密钥后可读')}
      />
      <Stat
        label="峰谷时段"
        value={peak ? (peak.inPeak ? '峰时' : '谷时') : '未启用'}
        meta={peak
          ? `下次${peak.nextIntoPeak ? '峰时' : '谷时'} ${peak.nextAtMs ? clockOf(peak.nextAtMs) : '—'} · 高峰 ${peakWindowsLabel(config)}`
          : '在 dsh-cost-meter 里开启峰谷计价后显示'}
      />
    </div>

    {budget && <div className="pilot-cost-budget" aria-label="预算进度">
      <div className="pilot-cost-budget-head">
        <span>预算</span>
        <span className="pilot-cost-budget-num">
          {formatUsd(budget.used / (Number(config.exchangeRate) || 1), config)} / {formatUsd(budget.amount / (Number(config.exchangeRate) || 1), config)}
        </span>
      </div>
      <div className="pilot-cost-bar">
        <span style={{ width: `${budget.percent.toFixed(1)}%` }} data-over={budget.over || undefined} />
      </div>
      <span className="pilot-cost-meta">{budget.percent.toFixed(0)}% 已用{budget.over ? ' · 已超出预算' : ''}</span>
    </div>}

    <div className="pilot-cost-models">
      <h3>今日按模型</h3>
      {rows.length === 0
        ? <p className="pilot-cost-meta">今天还没有可归属的调用。</p>
        : <table>
          <thead>
            <tr><th>模型</th><th>调用</th><th>Tokens</th><th>花费</th></tr>
          </thead>
          <tbody>
            {rows.map(row => <tr key={row.key}>
              <td className="pilot-cost-model" title={row.key}>
                {row.provider && <span className="pilot-cost-provider">{row.provider}</span>}
                {row.model}
              </td>
              <td className="pilot-cost-num">{row.calls}</td>
              <td className="pilot-cost-num">{formatTokens(row.tokens)}</td>
              <td className="pilot-cost-num">{formatUsd(row.cost, config)}</td>
            </tr>)}
          </tbody>
        </table>}
    </div>
    <p className="pilot-cost-note">
      完整设置（价目表、峰谷规则、余额来源、历史与导出）在 dsh-cost-meter 自己的「设置 → 费用」页；这里只放概览。
    </p>
  </Panel>;
}

function WorkbenchPage() {
  const todayTokens = useTodayTokens();
  const openSettings = () => toggleSettings(true);
  return <>
    <section className="pilot-token-card" aria-label="今日 Token 消耗">
      <div className="pilot-token-main">
        <span className="pilot-token-label">今日 Token 消耗</span>
        <span className="pilot-token-value" data-empty={todayTokens === 0 || undefined}>{todayTokens > 0 ? formatTokenCount(todayTokens) : '尚未消耗'}</span>
        <span className="pilot-token-hint">按今天活动过的会话累计；跨天会话会包含它的历史总量。</span>
      </div>
      {todayTokens === 0 && (
        <button type="button" className="pilot-pill is-small" onClick={openSettings}>打开配置页</button>
      )}
    </section>
    <CostPanel />
  </>;
}

registerPage({
  id: 'workbench',
  meta: { title: '工作台', hint: '概览、今日 Token 与费用', icon: 'home', group: '工作' },
  component: WorkbenchPage,
});

export { WorkbenchPage };
