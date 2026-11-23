import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apply, getSettings, labelOf, resetSettings, setSettings, speak, stopSpeech, subscribe, ttsSupported, type A11ySettings } from './store';

const useSettings = () => useSyncExternalStore(subscribe, getSettings, getSettings);

function Switch({ id, label, hint, on, set }: { id: string; label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="a11y-row">
      <span className="a11y-lab" id={`${id}-l`}>{label}{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={`${id}-l`} className={`a11y-sw${on ? ' on' : ''}`} onClick={() => set(!on)}><i aria-hidden="true" /><span>{on ? 'On' : 'Off'}</span></button>
    </div>
  );
}

export function A11yControl() {
  const s = useSettings(); const [open, setOpen] = useState(false); const btn = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const tts = ttsSupported(); const set = (p: Partial<A11ySettings>) => setSettings(p);

  // apply saved settings on load and whenever the OS preferences change
  useEffect(() => {
    apply(); const mqs = ['(prefers-reduced-motion: reduce)', '(prefers-contrast: more)'].map(q => { try { return window.matchMedia(q); } catch { return null; } });
    const f = () => apply(); mqs.forEach(m => m?.addEventListener?.('change', f)); return () => mqs.forEach(m => m?.removeEventListener?.('change', f));
  }, []);

  // keyboard: Alt+A toggles the panel · Esc closes it (and stops any speech)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') { e.preventDefault(); setOpen(o => !o); }
      else if (e.key === 'Escape') { stopSpeech(); if (open) { setOpen(false); btn.current?.focus(); } }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open]);

  // click / tap anywhere outside the panel (including the main screen) closes it. Capture phase so no page handler can swallow the event.
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { const t = e.target as Node | null; if (!t) return; if (panel.current?.contains(t) || btn.current?.contains(t)) return; setOpen(false); };
    document.addEventListener('pointerdown', out, true); return () => document.removeEventListener('pointerdown', out, true);
  }, [open]);

  // OFF by default. When the user switches it on: desktop mouse only (never touch or pen), after a short rest on the text. Switching it off stops speech at once.
  useEffect(() => {
    if (!s.readHover || !tts) return; let timer = 0; let last: Element | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return; window.clearTimeout(timer);
      const el = (e.target as Element | null)?.closest('button,a,h1,h2,h3,h4,p,li,label,input,select,summary,[role="button"],[role="option"],td,dd,dt');
      if (!el || el === last || el.closest('[aria-hidden="true"]')) return;
      timer = window.setTimeout(() => { last = el; const l = labelOf(el); if (l && l.length < 320) speak(l); }, 600);
    };
    const leave = () => { window.clearTimeout(timer); last = null; };
    document.addEventListener('pointerover', over); document.addEventListener('pointerleave', leave);
    return () => { window.clearTimeout(timer); document.removeEventListener('pointerover', over); document.removeEventListener('pointerleave', leave); stopSpeech(); };
  }, [s.readHover, tts]);

  // keep focus inside the panel when it opens; return it to the button when closed
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>('button,input')?.focus(); }, [open]);

  return (
    <div className="a11y-root">
      <button ref={btn} type="button" className="a11y-btn" aria-expanded={open} aria-controls="a11y-panel" aria-label="Accessibility settings (Alt+A)" title="Accessibility (Alt+A)" onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="4.6" r="1.8" fill="currentColor" stroke="none" /><path d="M4.5 8.2c5 1.5 10 1.5 15 0M12 8.6v5.2M12 13.8l-3.4 6.2M12 13.8l3.4 6.2" /></svg>
        <span className="a11y-btn-t">Accessibility</span>
      </button>
      {open && (
        <div ref={panel} id="a11y-panel" className="a11y-panel" role="dialog" aria-label="Accessibility settings">
          <div className="a11y-head"><h2>Accessibility</h2><button type="button" className="a11y-x" aria-label="Close accessibility settings" onClick={() => { setOpen(false); btn.current?.focus(); }}>×</button></div>

          <section aria-labelledby="a11y-s1"><h3 id="a11y-s1">Seeing</h3>
            <Switch id="hc" label="High contrast" hint="Black and white with bold outlines" on={s.contrast} set={v => set({ contrast: v })} />
            <div className="a11y-row"><span className="a11y-lab" id="ts-l">Text size</span>
              <div className="a11y-seg" role="group" aria-labelledby="ts-l">{([100, 125, 150] as const).map(n => <button type="button" key={n} aria-pressed={s.textSize === n} onClick={() => set({ textSize: n })}>{n === 100 ? 'Normal' : n === 125 ? 'Large' : 'Larger'}</button>)}</div></div>
            <Switch id="pf" label="Plain, easy-to-read font" hint="Simple sans-serif with more spacing" on={s.plainFont} set={v => set({ plainFont: v })} />
          </section>

          <section aria-labelledby="a11y-s2"><h3 id="a11y-s2">Motion</h3>
            <Switch id="rm" label="Reduce motion" hint="Short fade instead of the 3D journey; no animated backgrounds" on={s.reduceMotion} set={v => set({ reduceMotion: v })} />
          </section>

          <section aria-labelledby="a11y-s3"><h3 id="a11y-s3">Listening</h3>
            {!tts ? <p className="a11y-note">This browser has no built-in speech. Try Chrome, Edge, Safari or Firefox.</p>
              : <Switch id="rh" label="Read text under the mouse" hint="Move the mouse over text and pause briefly to hear it." on={s.readHover} set={v => { set({ readHover: v }); if (!v) stopSpeech(); }} />}
          </section>

          <div className="a11y-foot"><button type="button" className="a11y-b a11y-b--q" onClick={resetSettings}>Reset all</button>
            <p className="a11y-note"><kbd>Alt</kbd>+<kbd>A</kbd> this panel · <kbd>Esc</kbd> close</p></div>
        </div>
      )}
    </div>
  );
}
