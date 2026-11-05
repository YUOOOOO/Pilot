// 工作台「费用」区块的数据来源：dsh-cost-meter 提供的远程服务 `remote.costMeter`。
//
// 它把账本快照以 Typert RPC 暴露给同一个宿主里的客户端插件（`getLocalState()` 就是它自己
// 设置页首屏用的那份状态），所以这里不复制它的计价/落账逻辑，只读它的结果：
// - 全部方法返回 `{ ok: true, value } | { ok: false, error }` 信封，必须解包；
// - `getStateSince(pricesRev)` 在价格表版本没变时省掉整张价表（约占快照 56% 载荷），轮询用它；
// - 第三方客户端只读 `ctx.get('remote.costMeter')`，不要自己 `$mount`（会撞 gateway 的重复挂载校验）。
// 插件没装、或宿主还没挂上这个服务时，调用一律返回 null，页面显示安装提示而不是报错。

/** 一条按供应商/模型聚合的账目（金额单位 USD，见 cost-format.mjs 的说明） */
export interface CostModelEntry {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  calls?: number;
  cost?: number;
  apiCost?: number;
  costCny?: number;
  apiCostCny?: number;
  costEur?: number;
  apiCostEur?: number;
}

export interface CostDayRecord extends CostModelEntry {
  date?: string;
  byProviderModel?: Record<string, CostModelEntry>;
}

export interface CostBalance {
  status?: 'off' | 'ok' | 'error';
  message?: string;
  currency?: string;
  totalBalance?: number;
  grantedBalance?: number;
  toppedUpBalance?: number;
}

export interface CostMeterConfig {
  currency?: string;
  symbol?: string;
  decimals?: number;
  exchangeRate?: number;
  showTotalWithPlan?: boolean;
  peakEnabled?: boolean;
  peakEffectiveAt?: string;
  peakWindows?: { start: number; end: number }[];
  peakHolidays?: string[];
  hideOfficialBalance?: boolean;
  budget?: { enabled?: boolean; amount?: number; period?: string };
}

export interface CostMeterState {
  today: CostDayRecord;
  month: CostDayRecord;
  total: CostDayRecord;
  budgetUsed?: number;
  balance?: CostBalance;
  config: CostMeterConfig;
  pricesRev?: string;
  meta?: { now?: number; dayKey?: string; monthKey?: string; locale?: string; timezone?: string };
}

interface RemoteEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { message?: string; code?: string };
}

interface CostMeterRemote {
  getLocalState?(): Promise<RemoteEnvelope<CostMeterState>>;
  getState?(): Promise<RemoteEnvelope<CostMeterState>>;
  getStateSince?(pricesRev: string): Promise<RemoteEnvelope<CostMeterState>>;
}

interface ContextLike {
  get?(name: string): unknown;
  remote?: Record<string, unknown>;
}

/** 客户端插件上下文里拿不到 ctx.get 时退回属性访问 */
function remoteOf(ctx: ContextLike): CostMeterRemote | null {
  try {
    const viaGet = ctx.get?.('remote.costMeter');
    if (viaGet && typeof viaGet === 'object' && typeof (viaGet as CostMeterRemote).getLocalState === 'function') {
      return viaGet as CostMeterRemote;
    }
  } catch { /* 服务还没注册 */ }
  const nested = ctx.remote?.costMeter;
  if (nested && typeof nested === 'object' && typeof (nested as CostMeterRemote).getLocalState === 'function') {
    return nested as CostMeterRemote;
  }
  return null;
}

let context: ContextLike | null = null;
let bound: CostMeterRemote | null = null;
/** 上一次快照的价表版本，用来让轮询走 getStateSince（省掉价表） */
let pricesRev: string | null = null;

/** 在 client 的 apply 里调用一次；之后页面通过 readCostState 取数 */
export function bindCostMeter(ctx: ContextLike): void {
  context = ctx;
  bound = remoteOf(ctx);
  // 插件可能比 Pilot 晚一步挂载：先试一次，之后调用时再惰性重试
  if (bound !== null) return;
  let tries = 40;
  const retry = () => {
    if (!context) return;
    bound = remoteOf(context);
    if (bound !== null || --tries <= 0) return;
    setTimeout(retry, 250);
  };
  setTimeout(retry, 250);
}

/** 从一次 RPC 结果里取状态；信封失败时抛错，让上层决定重试 */
async function unwrap(promise: Promise<RemoteEnvelope<CostMeterState>>): Promise<CostMeterState> {
  const envelope = await promise;
  if (envelope?.ok === true && envelope.value) return envelope.value;
  const message = envelope?.error?.message || envelope?.error?.code || 'cost-meter 返回了失败结果';
  throw new Error(message);
}

/**
 * 费用状态快照；dsh-cost-meter 未安装 / 未加载时返回 null。
 * 依次尝试 getStateSince（增量）→ getLocalState（不等待联网）→ getState（完整）。
 */
export async function readCostState(): Promise<CostMeterState | null> {
  if (context === null) return null;
  const remote = bound ?? (bound = remoteOf(context));
  if (remote === null) return null;

  const attempts: (() => Promise<CostMeterState>)[] = [];
  if (pricesRev !== null && typeof remote.getStateSince === 'function') {
    const known = pricesRev;
    attempts.push(() => unwrap(remote.getStateSince!(known)));
  }
  if (typeof remote.getLocalState === 'function') attempts.push(() => unwrap(remote.getLocalState!()));
  if (typeof remote.getState === 'function') attempts.push(() => unwrap(remote.getState!()));

  for (const attempt of attempts) {
    try {
      const state = await attempt();
      if (typeof state.pricesRev === 'string') pricesRev = state.pricesRev;
      return state;
    } catch (error) {
      // 价表版本失效时清掉缓存，下一档直接用全量快照
      pricesRev = null;
      console.warn('[pilot] cost-meter state read failed:', error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

/** dsh-cost-meter 是否已在本宿主里可用（页面据此在「未安装」与「读取失败」之间分流） */
export function costMeterAvailable(): boolean {
  return bound !== null || (context !== null && remoteOf(context) !== null);
}

/** 安装命令，显示在空态里 */
export const COST_METER_INSTALL_COMMAND = 'dsh plugin --profile web add dsh-cost-meter';
