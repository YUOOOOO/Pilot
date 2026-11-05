import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetProgress, daySummary, displayCost, formatMoney, formatTokens, formatUsd, modelRows, peakPhaseAt, peakTransition, peakWindowsLabel,
} from '../packages/dsh-pilot/src/workbench/cost-format.mjs';

/** 费用概览卡片的纯计算：币种换算、预算、峰谷与按模型明细 */

const cny = { currency: 'CNY', symbol: '¥', decimals: 2, exchangeRate: 7.1 };

test('formatMoney keeps 0 decimals and tiny amounts readable', () => {
  assert.equal(formatMoney(1.5, { symbol: '¥', decimals: 2 }), '¥1.5');
  assert.equal(formatMoney(2, { symbol: '¥', decimals: 0 }), '¥2');
  assert.equal(formatMoney(0.0004, { symbol: '¥', decimals: 2 }), '¥0.0004');
  assert.equal(formatMoney(12.345, { symbol: '¥', decimals: 2 }), '¥12.35');
});

test('formatUsd applies the USD → display rate', () => {
  assert.equal(formatUsd(1, cny), '¥7.1');
  assert.equal(formatUsd(0, cny), '¥0');
  // 汇率缺失时按 1 处理，不显示 NaN
  assert.equal(formatUsd(0.5, { symbol: '$' }), '$0.5');
});

test('displayCost prefers frozen local amounts and falls back to USD', () => {
  const entry = { cost: 0.2, apiCost: 0.1, apiCostCny: 0.71 };
  assert.equal(displayCost(entry, cny), 0.1);
  // 冻结金额 ÷ 汇率 = USD 等值，再乘汇率还原
  assert.equal(formatUsd(displayCost(entry, cny), cny), '¥0.71');
  assert.equal(displayCost({ cost: 0.3 }, cny), 0.3);
  assert.equal(displayCost({ apiCost: 0.2, apiCostCny: 0 }, cny), 0.2);
});

test('showTotalWithPlan switches to the plan-inclusive amount', () => {
  const entry = { cost: 0.4, apiCost: 0.1, costCny: 2.84 };
  assert.equal(displayCost(entry, { ...cny, showTotalWithPlan: true }), 0.4);
  assert.equal(formatUsd(displayCost(entry, { ...cny, showTotalWithPlan: true }), cny), '¥2.84');
});

test('daySummary and modelRows derive calls, tokens and order', () => {
  const day = {
    input: 1000,
    output: 500,
    calls: 3,
    cost: 0.6,
    byProviderModel: {
      'deepseek:deepseek-flash': { input: 800, output: 200, calls: 2, cost: 0.4 },
      'openrouter:kimi-k3': { input: 200, output: 300, calls: 1, cost: 0.2 },
      'deepseek:unused': { input: 0, output: 0, calls: 0, cost: 0 },
    },
  };
  assert.deepEqual(daySummary(day, cny), { calls: 3, tokens: 1500, cost: 0.6 });
  const rows = modelRows(day, cny);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider, 'deepseek');
  assert.equal(rows[0].model, 'deepseek-flash');
  assert.equal(rows[1].model, 'kimi-k3');
  assert.equal(rows[0].tokens, 1000);
});

test('formatTokens is compact and boundary safe', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1500), '1.5K');
  assert.equal(formatTokens(456000), '456K');
  assert.equal(formatTokens(999499), '999K');
  assert.equal(formatTokens(999500), '1M');
});

test('budgetProgress converts budgetUsed into display currency', () => {
  const state = { budgetUsed: 0.5 };
  const progress = budgetProgress(state, { ...cny, budget: { enabled: true, amount: 10 } });
  assert.ok(progress);
  assert.equal(progress.used, 3.55);
  assert.equal(progress.percent, 35.5);
  assert.equal(progress.over, false);
  assert.equal(budgetProgress(state, { ...cny, budget: { enabled: false, amount: 10 } }), null);
  assert.equal(budgetProgress(state, { ...cny, budget: { enabled: true, amount: 0 } }), null);
});

test('peakPhaseAt mirrors the peak windows, weekends and holidays', () => {
  const config = {
    peakEnabled: true,
    peakEffectiveAt: '2026-08-17T00:00:00Z',
    peakWindows: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
    peakHolidays: ['2026-10-01'],
  };
  // 2026-11-05 是周四；02:30 UTC 落在 01–04 峰时窗口
  const peak = Date.parse('2026-11-05T02:30:00Z');
  assert.equal(peakPhaseAt(peak, config), 'peak');
  // 同一天 05:00 UTC 在两个窗口之间
  assert.equal(peakPhaseAt(Date.parse('2026-11-05T05:00:00Z'), config), 'offPeak');
  // 周六 02:30 UTC 全天谷时
  assert.equal(peakPhaseAt(Date.parse('2026-11-07T02:30:00Z'), config), 'offPeak');
  // 法定节假日全天谷时（北京日期 2026-10-01，UTC 10-01 02:30）
  assert.equal(peakPhaseAt(Date.parse('2026-10-01T02:30:00Z'), config), 'offPeak');
  // 未启用 / 未到生效时间
  assert.equal(peakPhaseAt(peak, { ...config, peakEnabled: false }), null);
  assert.equal(peakPhaseAt(Date.parse('2026-08-01T02:30:00Z'), config), null);
});

test('peakTransition finds the next switch and its direction', () => {
  const config = {
    peakEnabled: true,
    peakWindows: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
    peakHolidays: [],
  };
  // 周四 02:30 UTC：下一次切换是 04:00 UTC 进谷时
  const transition = peakTransition(Date.parse('2026-11-05T02:30:00Z'), config);
  assert.equal(transition.inPeak, true);
  assert.equal(transition.nextIntoPeak, false);
  assert.equal(transition.nextAtMs, Date.parse('2026-11-05T04:00:00Z'));
  // 周四 05:00 UTC：下一次切换是 06:00 UTC 进峰时
  const next = peakTransition(Date.parse('2026-11-05T05:00:00Z'), config);
  assert.equal(next.inPeak, false);
  assert.equal(next.nextIntoPeak, true);
  assert.equal(peakWindowsLabel(config), '01:00–04:00 / 06:00–10:00');
});
