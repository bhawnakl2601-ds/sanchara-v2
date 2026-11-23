import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../app/state';
import type { Dest } from '../app/transition';
import { NavPanel, type PanelState } from './NavPanel';
import { IconNetwork, IconGuide, IconRoute, IconAlert } from './icons';
import { metro } from '../engine';

const OPTIONS: { dest: Dest; n: string; tag: string; label: string; heading: string; desc: string; icon: JSX.Element; side: 'left' | 'right'; wip?: boolean }[] = [
  { dest: 'planner', n: '01', tag: '', label: '', heading: 'Plan your Journey', desc: 'Find your route through Bengaluru ', icon: <IconRoute />, side: 'left' },
  { dest: 'map', n: '02', tag: '', label: '', heading: 'Map of Network', desc: 'Discover every station, metro line, and interchange across Bengaluru.', icon: <IconNetwork />, side: 'left' },
  { dest: 'alerts', n: '03', tag: '', label: '', heading: 'Alerts and Delays', desc: 'Verified delays and closures and route changes', icon: <IconAlert />, side: 'right' },
  { dest: 'guide', n: '04', tag: '', label: '', heading: 'First Time Guide and Contacts', desc: 'A Step-by-Step Guide to Metro', icon: <IconGuide />, side: 'right' },
];

export function Hub({ onSlot }: { onSlot: (r: DOMRect) => void }) {
  const { hubVisible, view, selected, go } = useApp();
  const slot = useRef<HTMLDivElement>(null); const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = slot.current!; const report = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) onSlot(r); };
    const ro = new ResizeObserver(report); ro.observe(el); addEventListener('resize', report); main.current?.addEventListener('scroll', report, { passive: true }); report();
    return () => { ro.disconnect(); removeEventListener('resize', report); main.current?.removeEventListener('scroll', report); };
  }, [onSlot]);
  const state = (d: Dest): PanelState => !hubVisible ? 'out' : selected === d ? 'selected' : selected ? 'dim' : view === 'returning-home' && !hubVisible ? 'out' : 'in';
  const on = hubVisible && !selected;
  return (
    <motion.main ref={main} className={`hub${hubVisible ? '' : ' hub--off'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} aria-hidden={!hubVisible}>
      <header className="hub-head">
        <div className="brand"><h1>SANCHARA</h1><span className="brand-kn" lang="kn"></span></div>
        <div className="head-meta"><span lang="en"><span lang="kn"></span></span>
         </div>
      </header>
      <div className="hub-grid">
        <nav className="col col--left" aria-label="Primary">{OPTIONS.filter(o => o.side === 'left').map((o, i) => <NavPanel key={o.dest} idx={i} {...o} state={state(o.dest)} onClick={() => on && go(o.dest)} />)}</nav>
        <div className="slot" ref={slot} aria-hidden />
        <nav className="col col--right" aria-label="Services">{OPTIONS.filter(o => o.side === 'right').map((o, i) => <NavPanel key={o.dest} idx={i + 2} {...o} state={state(o.dest)} onClick={() => on && go(o.dest)} />)}</nav>
      </div>
      <footer className="hub-foot"><a className="home-link" href="/">&larr; All SANCHARA services</a><span className="hint"></span></footer>
    </motion.main>
  );
}
