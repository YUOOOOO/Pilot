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
