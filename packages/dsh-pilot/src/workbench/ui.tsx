/** @jsxRuntime classic */
import * as React from 'react';

/** 纸卡分组：标题 + 一行说明 + 右上角动作（对齐 dev-workbench 的 Panel 用法）。 */
export function Panel({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return <section className="pilot-panel">
    <header className="pilot-panel-head">
      <div className="pilot-panel-head-text">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="pilot-panel-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

/** 设置行：左侧标题 + 说明，右侧控件（开关 / 分段 / 按钮 / 取值）。 */
export function SettingsRow({ title, hint, control }: { title: string; hint?: string; control?: React.ReactNode }) {
  return <div className="pilot-setrow">
    <div className="pilot-setrow-text">
      <span className="pilot-setrow-title">{title}</span>
      {hint && <small className="pilot-setrow-hint">{hint}</small>}
    </div>
    <div className="pilot-setrow-control">{control}</div>
  </div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(next: boolean): void; label: string }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={checked ? 'pilot-switch is-on' : 'pilot-switch'}
    onClick={() => onChange(!checked)}
  ><span className="pilot-switch-dot" aria-hidden="true" /></button>;
}

export interface SegmentItem { value: string; label: string }

export function Segmented({ items, value, onChange, label }: { items: SegmentItem[]; value: string; onChange(next: string): void; label: string }) {
  return <div className="pilot-seg" role="group" aria-label={label}>
    {items.map(item => <button
      key={item.value}
      type="button"
      className={item.value === value ? 'is-on' : ''}
      aria-pressed={item.value === value}
      onClick={() => onChange(item.value)}
    >{item.label}</button>)}
  </div>;
}

/** 单行文本输入（设置里的路径、模型名、密钥等） */
export function TextField({ value, onChange, label, placeholder, type = 'text', disabled }: {
  value: string; onChange(next: string): void; label: string; placeholder?: string; type?: 'text' | 'password' | 'url'; disabled?: boolean;
}) {
  return <input
    className="pilot-input"
    type={type}
    aria-label={label}
    placeholder={placeholder}
    value={value}
    disabled={disabled}
    spellCheck={false}
    onChange={event => onChange(event.target.value)}
  />;
}

/** 数字输入：空值不回写，越界按 min/max 收口，整数项四舍五入（宿主 zod 要求 int 的字段拿到小数会拒收） */
export function NumberField({ value, onChange, label, min, max, step = 1, width = 96, integer = true }: {
  value: number; onChange(next: number): void; label: string; min?: number; max?: number; step?: number; width?: number; integer?: boolean;
}) {
  return <input
    className="pilot-input is-number"
    style={{ width }}
    type="number"
    inputMode="numeric"
    aria-label={label}
    value={Number.isFinite(value) ? value : ''}
    min={min}
    max={max}
    step={step}
    onChange={event => {
      const text = event.target.value;
      if (text === '') return;
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return;
      const rounded = integer ? Math.round(parsed) : parsed;
      const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, rounded));
      onChange(clamped);
    }}
  />;
}
