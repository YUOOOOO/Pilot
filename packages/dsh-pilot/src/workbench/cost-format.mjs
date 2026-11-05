// 费用卡片的纯计算：把 dsh-cost-meter 的 CostState 变成工作台要显示的数字与文案。
//
// 单位约定（与 cost-meter 的客户端镜像一致）：
// - day.cost / day.apiCost / byProviderModel[*].cost 是 **USD**；
// - costCny / apiCostCny（以及 Eur 版本）是按事件发生时刻冻结的本币金额；
// - config.exchangeRate 是「USD → 显示币种」的汇率，config.symbol / config.decimals 决定格式；
// - config.showTotalWithPlan 为真时用 cost（含 Plan 折算），否则用 apiCost（真金白银）。
// 这些函数不碰 DOM、不碰网络，宿主与浏览器两端共用，`npm test` 直接覆盖。

/** 余额币种符号；配置里的 symbol 只用于花费金额 */
const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€' };

export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || (typeof code === 'string' && code ? `${code} ` : '');
}

/** 与 cost-meter 的 lib/pricing.js formatMoney 同规则：symbol + 可调小数位 */
export function formatMoney(value, config) {
  const symbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$';
  const requested = Number(config?.decimals);
  const decimals = Math.max(0, Math.min(10, Number.isFinite(requested) ? Math.floor(requested) : 2));
  const amount = Number.isFinite(value) ? value : 0;
  let effective = decimals;
  // 小于最小显示单位时不四舍五入成 0，多给两位
  if (amount > 0 && amount < Math.pow(10, -decimals)) effective = decimals + 2;
  const fixed = amount.toFixed(effective).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  return symbol + fixed;
}

/** USD 金额 → 显示币种字符串（汇率与小数位取自 config） */
export function formatUsd(usd, config) {
  const rate = Number(config?.exchangeRate);
  const value = (Number.isFinite(usd) ? usd : 0) * (Number.isFinite(rate) && rate > 0 ? rate : 1);
  return formatMoney(value, config);
}

/**
 * 一条账目记录的 USD 等值金额（镜像 cost-meter 的 displayCostOf）。
 * 优先用冻结的本币金额 ÷ 当前汇率，缺字段或为 0 时退回 USD 金额。
 */
export function displayCost(entry, config) {
  if (!entry || typeof entry !== 'object') return 0;
  const suffix = { CNY: 'Cny', EUR: 'Eur' }[config?.currency];
  const withPlan = config?.showTotalWithPlan === true;
  const usd = withPlan
    ? Number(entry.cost) || 0
    : Number(entry.apiCost ?? entry.cost) || 0;
  const saved = suffix ? Number(entry[`${withPlan ? 'cost' : 'apiCost'}${suffix}`]) : NaN;
  if (!Number.isFinite(saved)) return usd;
  if (saved === 0 && usd > 0) return usd;
  const rate = Number(config?.exchangeRate);
  return saved / (Number.isFinite(rate) && rate > 0 ? rate : 1);
}

/** 紧凑 token 计数：999 / 12.3K / 456K / 1.2M（与宿主、cost-meter 一致） */
export function formatTokens(value) {
  const n = Math.max(0, Number(value) || 0);
  const scaled = x => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  if (n < 1000) return String(Math.round(n));
  if (n >= 999500) return `${scaled(n / 1000000)}M`;
  if (n < 1000000) return `${scaled(n / 1000)}K`;
  return `${scaled(n / 1000000)}M`;
}

/** 一条日记录的汇总：调用次数、输入/输出 token 与金额（USD 等值） */
export function daySummary(entry, config) {
  const day = entry && typeof entry === 'object' ? entry : {};
  const input = Number(day.input) || 0;
  const output = Number(day.output) || 0;
  return {
    calls: Number(day.calls) || 0,
    tokens: input + output,
    cost: displayCost(day, config),
  };
}

/** 今日按「供应商 / 模型」聚合的明细，按金额降序，最多 limit 行 */
export function modelRows(entry, config, limit = 6) {
  const map = entry?.byProviderModel;
  if (!map || typeof map !== 'object') return [];
  const rows = Object.entries(map)
    .map(([key, value]) => {
      // cost-meter 的键是 `provider:model`（模型名里不会出现 ':'，路由变体靠后缀）
      const split = key.indexOf(':');
      const provider = split > 0 ? key.slice(0, split) : '';
      const model = split > 0 ? key.slice(split + 1) : key;
      const input = Number(value?.input) || 0;
      const output = Number(value?.output) || 0;
      return {
        key,
        provider,
        model,
        calls: Number(value?.calls) || 0,
        tokens: input + output,
        cost: displayCost(value, config),
      };
    })
    .filter(row => row.cost > 0 || row.tokens > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  return rows.slice(0, Math.max(1, limit));
}

/**
 * DeepSeek 峰谷时段：镜像 cost-meter 的 configuredPeakAt（lib/peak-schedule.js）。
 * 峰谷窗口按 UTC 小时；周末（北京时间日期）与法定节假日全天谷时。
 * @returns 'peak' | 'offPeak' | null（未启用 / 未到生效时间）
 */
export function peakPhaseAt(atMs, config) {
  if (config?.peakEnabled !== true) return null;
  const effectiveAt = Date.parse(config?.peakEffectiveAt || '');
  if (Number.isFinite(effectiveAt) && atMs < effectiveAt) return null;
  const windows = Array.isArray(config?.peakWindows) ? config.peakWindows : [];
  if (windows.length === 0) return null;
  // 北京时间（UTC+8）的日期用于判断周末与节假日
  const beijing = new Date(atMs + 8 * 3600000);
  const day = beijing.getUTCDay();
  const dayKey = beijing.toISOString().slice(0, 10);
  const holidays = Array.isArray(config?.peakHolidays) ? config.peakHolidays : [];
  if (day === 0 || day === 6 || holidays.includes(dayKey)) return 'offPeak';
  const utc = new Date(atMs);
  const hour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600;
  const inWindow = windows.some(w => (w.start < w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end));
  return inWindow ? 'peak' : 'offPeak';
}

/**
 * 峰谷阶段的切换时间：在前后若干天的候选时刻里找下一次状态变化。
 * @returns {{inPeak: boolean, nextAtMs: number|null, nextIntoPeak: boolean}|null}
 */
export function peakTransition(atMs, config) {
  const phase = peakPhaseAt(atMs, config);
  if (phase === null) return null;
  const windows = Array.isArray(config?.peakWindows) ? config.peakWindows : [];
  const hours = new Set();
  for (let h = 0; h < 24; h++) hours.add(h);
  for (const w of windows) { hours.add(w.start); hours.add(w.end); }
  const midnight = Math.floor(atMs / 86400000) * 86400000;
  let next = null;
  for (let delta = 0; delta <= 3 && next === null; delta++) {
    for (const hour of [...hours].sort((a, b) => a - b)) {
      const at = midnight + delta * 86400000 + hour * 3600000;
      if (at <= atMs) continue;
      if (peakPhaseAt(at, config) !== phase) { next = at; break; }
    }
  }
  if (next === null) return { inPeak: phase === 'peak', nextAtMs: null, nextIntoPeak: false };
  return { inPeak: phase === 'peak', nextAtMs: next, nextIntoPeak: peakPhaseAt(next, config) === 'peak' };
}

/** 峰谷窗口文案：UTC 小时 → 「01:00–04:00 / 06:00–10:00」 */
export function peakWindowsLabel(config) {
  const windows = Array.isArray(config?.peakWindows) ? config.peakWindows : [];
  if (windows.length === 0) return '';
  return windows
    .map(w => `${String(w.start).padStart(2, '0')}:00–${String(w.end).padStart(2, '0')}:00`)
    .join(' / ');
}

/** 预算进度（% 已用）；未启用或金额非法时返回 null */
export function budgetProgress(state, config) {
  const budget = config?.budget;
  if (budget?.enabled !== true) return null;
  const amount = Number(budget.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rate = Number(config?.exchangeRate);
  const usedUsd = Number(state?.budgetUsed);
  const used = (Number.isFinite(usedUsd) ? usedUsd : 0) * (Number.isFinite(rate) && rate > 0 ? rate : 1);
  return {
    used,
    amount,
    percent: Math.max(0, Math.min(100, (used / amount) * 100)),
    over: used > amount,
  };
}
