import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { metro, stationList, searchStations, shortName } from '../engine';

export const LinePips = ({ ids }: { ids: string[] }) => <span className="pips">{ids.map(l => <i key={l} style={{ background: metro.lines[l].color }} title={metro.lines[l].name + ' Line'} />)}</span>;

interface Props { label: string; value: string | null; onChange: (id: string | null) => void; placeholder?: string; badge?: string; compact?: boolean }
/** Searchable station combobox: name, code, alias and Kannada search; full keyboard support; empty state. */
export function StationSelect({ label, value, onChange, placeholder = 'Search station or code', badge, compact }: Props) {
  const id = useId(); const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  const sel = value ? metro.stations[value] : null;
  const results = useMemo(() => searchStations(stationList, q, 30), [q]);
  useEffect(() => setActive(0), [q, open]);
  useEffect(() => { const h = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; addEventListener('pointerdown', h); return () => removeEventListener('pointerdown', h); }, []);
  useEffect(() => { if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  const pick = (sid: string) => { onChange(sid); setQ(''); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0); } else if (e.key === 'End' && open) { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active].id); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); } else if (q) setQ(''); }
    else if (e.key === 'Backspace' && !q && sel) onChange(null);
  };
  return (
    <div className={`ss${compact ? ' ss--compact' : ''}`} ref={box}>
      <label className="ss-label" htmlFor={id}>{badge && <b>{badge}</b>}{label}</label>
      <div className={`ss-field${open ? ' is-open' : ''}`}>
        {sel && !open && !q && <span className="ss-value" onClick={() => { setOpen(true); input.current?.focus(); }}><LinePips ids={sel.lines} /><span>{shortName(sel.name)}</span><em>{sel.code}</em></span>}
        <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off" spellCheck={false} value={q} placeholder={sel ? '' : placeholder} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
        {sel && <button type="button" className="ss-clear" aria-label={`Clear ${label}`} onClick={() => { onChange(null); input.current?.focus(); }}>×</button>}
      </div>
      {open && (
        <ul className="ss-list" role="listbox" id={`${id}-list`} aria-label={`${label} suggestions`}>
          {results.length === 0 && <li className="ss-empty" role="option" aria-selected="false" aria-disabled="true">No station matches “{q}”. Try a name, code or Kannada text.</li>}
          {results.map((s, i) => (
            <li key={s.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} onPointerEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(s.id)}>
              <LinePips ids={s.lines} /><span className="ss-name">{shortName(s.name)}{s.interchange && <small> · interchange</small>}</span><span className="ss-kn" lang="kn">{s.kn}</span><em>{s.code}</em>
            </li>))}
        </ul>)}
    </div>
  );
}
