/** @jsxRuntime classic */
import * as React from 'react';

// Pilot 品牌章：强调色圆角方块 + 白色纸页字形。颜色走 --pilot-accent/--pilot-sheet，
// 因此会随设置里的强调色切换，也会随明暗主题翻转。
export function PilotMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="9" fill="var(--pilot-accent,#0f766e)" />
    <path d="m9 23 6-15 8 15-8-5-6 5Z" stroke="var(--pilot-sheet,#ffffff)" strokeWidth="1.9" strokeLinejoin="round" />
  </svg>;
}

export function PilotName() {
  return <span className="pilot-brand-name" style={{ fontFamily: 'var(--pilot-serif, Georgia, serif)', fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' }}>Pilot<span className="pilot-brand-dot" aria-hidden="true">.</span></span>;
}
