/** @jsxRuntime classic */
import * as React from 'react';
import { pageEntries } from './registry';
import { go, togglePalette, useWorkbench } from './store';

/** ⌘K 命令面板：只列注册表里的页面，回车/点击跳转，↑↓ 移动。 */
export function CommandPalette() {
  const { palette } = useWorkbench();
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (!palette) { setQuery(''); setIndex(0); }
  }, [palette]);
  if (!palette) return null;
  const needle = query.trim().toLowerCase();
  const shown = pageEntries().filter(entry => !needle || `${entry.meta.title} ${entry.meta.hint}`.toLowerCase().includes(needle));
  const pick = (id: string) => { go(id); togglePalette(false); };
  return <div className="pilot-palette-mask" role="presentation" onClick={() => togglePalette(false)}>
    <div className="pilot-palette" role="dialog" aria-modal="true" aria-label="命令面板" onClick={event => event.stopPropagation()}>
      <input
        className="pilot-palette-input"
        autoFocus
        value={query}
        placeholder="跳转到页面…"
        aria-label="搜索页面"
        onChange={event => { setQuery(event.target.value); setIndex(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); togglePalette(false); return; }
          if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(value + 1, shown.length - 1)); return; }
          if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(value - 1, 0)); return; }
          if (event.key === 'Enter') { event.preventDefault(); const row = shown[index]; if (row) pick(row.id); }
        }}
      />
      <ul className="pilot-palette-list" role="listbox" aria-label="页面">
        {shown.map((entry, position) => <li key={entry.id} role="option" aria-selected={position === index}>
          <button
            type="button"
            className={position === index ? 'pilot-palette-row is-on' : 'pilot-palette-row'}
            onClick={() => pick(entry.id)}
            onMouseEnter={() => setIndex(position)}
          >
            <span className="pilot-palette-title">{entry.meta.title}</span>
            <span className="pilot-palette-hint">{entry.meta.hint}</span>
            <kbd className="pilot-kbd">{position + 1}</kbd>
          </button>
        </li>)}
        {shown.length === 0 && <li className="pilot-palette-empty">没有匹配的页面</li>}
      </ul>
    </div>
  </div>;
}
